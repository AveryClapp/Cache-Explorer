"""SDK-independent validation and address mapping for local hotspot imports."""
import json
import hashlib
import struct
import uuid
from pathlib import Path

from jsonschema import Draft7Validator

MAX_BYTES = 16 * 1024 * 1024
MAX_ANNOTATION_STATE_BYTES = 1024 * 1024


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def read_bundle(path, schema_path=None):
    with open(path, "rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Bundle exceeds 16 MiB")
    bundle = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object,
                        parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Non-finite JSON number")))
    return validate_bundle(bundle, schema_path)


def validate_bundle(bundle, schema_path=None):
    schema_path = schema_path or Path(__file__).with_name("hotspots.schema.json")
    # Only the packaged schema is loaded, never a URL/schema from the input.
    schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
    Draft7Validator(schema).validate(bundle)
    images = {image["id"]: image for image in bundle["images"]}
    if len(images) != len(bundle["images"]) or any(image["id"] != "sha256:" + image["sha256"] for image in images.values()):
        raise ValueError("Duplicate or inconsistent image identity")
    if bundle["coverage"]["returnedSites"] != len(bundle["codeHotspots"]):
        raise ValueError("Inconsistent coverage")
    clang = bundle["capture"]["kind"] == "clang-cl"
    seen = set()
    for site in bundle["codeHotspots"]:
        image_id = site["location"]["imageId"]
        rva = int(site["location"]["rva"], 16)
        expected = rva - 1 if clang else rva
        key = (image_id, rva)
        if image_id not in images or rva >= images[image_id]["imageSize"] or expected < 0 or key in seen:
            raise ValueError("Unknown image, invalid RVA or duplicate site")
        seen.add(key)
        if int(site["lookup"]["rva"], 16) != expected or site["lookup"]["method"] != ("return-pc-minus-one" if clang else "instruction-pc"):
            raise ValueError("Wrong capture lookup mode")
        if (site["navigationConfidence"] == "unresolved") == ("symbol" in site):
            raise ValueError("Confidence disagrees with symbols")
        if "symbol" in site and int(site["symbol"]["functionRva"], 16) > expected:
            raise ValueError("Function starts after site")
        metrics = site["metrics"]
        accesses, misses = metrics["accesses"], metrics["l1dMisses"]
        if metrics["reads"] + metrics["writes"] != accesses or metrics["l1dHits"] + misses != accesses:
            raise ValueError("Inconsistent metric counts")
        if abs(metrics["l1dMissRate"] - (misses / accesses if accesses else 0)) > .00011:
            raise ValueError("Inconsistent miss rate")
    return bundle


def map_sites(bundle, input_sha256, image_base):
    """Map only the SHA-matched image. Runtime load addresses are never used."""
    if isinstance(input_sha256, bytes):
        input_sha256 = input_sha256.hex()
    images = [image for image in bundle["images"] if image["sha256"] == str(input_sha256).lower()]
    if len(images) != 1:
        raise ValueError("Binary SHA-256 mismatch or missing input hash. No annotations applied.")
    if not 0 <= image_base <= 0xffffffff:
        raise ValueError("Expected a PE32 image base")
    rows = []
    for site in bundle["codeHotspots"]:
        if site["location"]["imageId"] == images[0]["id"]:
            address = image_base + int(site["lookup"]["rva"], 16)
            if address > 0xffffffff:
                raise ValueError("Rebased address overflows PE32")
            rows.append((address, site))
    return sorted(rows, key=lambda row: (-row[1]["metrics"]["l1dMisses"], row[0]))


def update_annotation(comment, annotation=None):
    """Replace only our standalone line, preserving user comments verbatim."""
    lines = (comment or "").splitlines()
    lines = [line for line in lines if not line.startswith("[Hardware Explorer Preview] ")]
    if annotation:
        lines.append("[Hardware Explorer Preview] " + annotation)
    return "\n".join(lines)


def refresh_annotations(raw_state, sha256, image_base, annotations, read_comment, write_comment, save_state):
    """Replace only owned comment lines; persist RVAs so cleanup survives IDB reload/rebase.

    Keep a write-ahead union until all comment writes succeed. A failed import can
    then be cleared/retried without losing ownership of partially written notes.
    All validation and comment reads finish before the first write.
    """
    if not isinstance(sha256, str) or len(sha256) != 64 or any(c not in '0123456789abcdef' for c in sha256):
        raise ValueError("Missing input SHA-256 for annotation ownership")
    if type(image_base) is not int or not 0 <= image_base <= 0xffffffff:
        raise ValueError("Expected a PE32 image base")
    previous = []
    if raw_state:
        if len(raw_state) > MAX_ANNOTATION_STATE_BYTES:
            raise ValueError("Annotation ownership state exceeds its limit")
        state = json.loads(raw_state, object_pairs_hook=_unique_object)
        if not isinstance(state, dict) or set(state) != {'version', 'sha256', 'rvas'} or type(state['version']) is not int or state['version'] != 1 or state['sha256'] != sha256:
            raise ValueError("Invalid or mismatched annotation ownership state")
        previous = state['rvas']
        if not isinstance(previous, list) or len(previous) > 20000:
            raise ValueError("Invalid annotation ownership list")
    if not isinstance(annotations, dict) or len(annotations) > 10000:
        raise ValueError("Too many new annotations")
    if any(type(rva) is not int or not 0 <= rva <= 0xffffffff - image_base for rva in [*previous, *annotations]):
        raise ValueError("Annotation RVA overflows PE32")
    if any(not isinstance(note, str) or len(note) > 4096 or '\n' in note or '\r' in note for note in annotations.values()):
        raise ValueError("Invalid annotation text")
    owned = sorted(set(previous) | set(annotations))
    if len(owned) > 20000:
        raise ValueError("Clear the previous annotations before importing more sites")
    changes = []
    for rva in owned:
        old = read_comment(image_base + rva) or ''
        new = update_annotation(old, annotations.get(rva))
        if new != old:
            changes.append((image_base + rva, new))

    def persist(rvas):
        data = json.dumps({'version': 1, 'sha256': sha256, 'rvas': rvas}, separators=(',', ':')).encode('utf-8')
        if not save_state(data):
            raise RuntimeError("Could not save annotation ownership; retry or clear annotations")

    persist(owned)
    for address, comment in changes:
        if not write_comment(address, comment):
            raise RuntimeError("Could not update an instruction comment; retry or clear annotations")
    persist(sorted(annotations))


def nearest_mapping(address, mapped_addresses, function_contains):
    candidates = [ea for ea in mapped_addresses if function_contains(ea)]
    return min(candidates, key=lambda ea: (abs(ea - address), ea)) if candidates else None


def verify_codeview(path, expected_sha256, expected_codeview):
    """Read only the explicitly selected PE, never embedded PDB/source paths."""
    with open(path, "rb") as stream:
        stream.seek(0, 2)
        size = stream.tell()
        if size < 64 or size > 512 * 1024 * 1024:
            raise ValueError("PE identity file size is outside the safety limit")

        def read_at(offset, count):
            if offset < 0 or count < 0 or offset + count > size:
                raise ValueError("PE identity header is out of bounds")
            stream.seek(offset)
            data = stream.read(count)
            if len(data) != count:
                raise ValueError("Truncated PE identity header")
            return data

        def digest():
            stream.seek(0)
            result = hashlib.sha256()
            while chunk := stream.read(1024 * 1024):
                result.update(chunk)
            return result.hexdigest()

        if digest() != expected_sha256:
            raise ValueError("Selected PE SHA-256 mismatch")
        if read_at(0, 2) != b'MZ':
            raise ValueError("Missing DOS header")
        pe = struct.unpack('<I', read_at(0x3c, 4))[0]
        coff = read_at(pe, 24)
        machine, sections = struct.unpack_from('<HH', coff, 4)
        optional_size = struct.unpack_from('<H', coff, 20)[0]
        if coff[:4] != b'PE\0\0' or machine != 0x14c or not 1 <= sections <= 96 or optional_size < 152:
            raise ValueError("Expected a bounded x86 PE32 image")
        optional = read_at(pe + 24, optional_size)
        if struct.unpack_from('<H', optional)[0] != 0x10b or struct.unpack_from('<I', optional, 92)[0] < 7:
            raise ValueError("PE32 image has no debug directory")
        debug_rva, debug_size = struct.unpack_from('<II', optional, 144)
        if debug_size % 28 or not 28 <= debug_size <= 28 * 128:
            raise ValueError("Invalid PE debug directory")
        debug_offset = None
        for index in range(sections):
            section = read_at(pe + 24 + optional_size + index * 40, 40)
            virtual_size, virtual_address, raw_size, raw_offset = struct.unpack_from('<IIII', section, 8)
            if virtual_address <= debug_rva and debug_rva + debug_size <= virtual_address + raw_size:
                debug_offset = raw_offset + debug_rva - virtual_address
                break
        if debug_offset is None:
            raise ValueError("Unmapped PE debug directory")
        matched = False
        for offset in range(debug_offset, debug_offset + debug_size, 28):
            entry = read_at(offset, 28)
            kind, length, _, pointer = struct.unpack_from('<IIII', entry, 12)
            if kind == 2 and 24 <= length <= 65536:
                record = read_at(pointer, length)
                if record[:4] == b'RSDS':
                    cv = {"guid": str(uuid.UUID(bytes_le=record[4:20])), "age": struct.unpack_from('<I', record, 20)[0]}
                    matched |= cv == expected_codeview
        if not matched or digest() != expected_sha256:
            raise ValueError("CodeView GUID/age mismatch or image changed")
