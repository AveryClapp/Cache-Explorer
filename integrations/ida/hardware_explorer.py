"""Experimental IDA/Hex-Rays adapter. No licensed-runtime compatibility claim yet.

Install the packaged directory into IDA's plugins directory. Install requirements
into IDA's Python interpreter. Import via Edit > Plugins > Hardware Explorer.
"""
from pathlib import Path
import importlib.util

import ida_bytes
import ida_funcs
import ida_ida
import ida_idaapi
import ida_kernwin
import ida_nalt

# Load a sibling module without changing the global Python import search path.
_spec = importlib.util.spec_from_file_location("hardware_explorer_bundle", Path(__file__).parent / "hardware_explorer_support" / "hardware_explorer_bundle.py")
bundle_io = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bundle_io)


def navigate(address, capture_kind):
    head = ida_bytes.get_item_head(address)
    if not ida_bytes.is_code(ida_bytes.get_full_flags(head)) or (capture_kind == 'intel-pin' and head != address):
        ida_kernwin.jumpto(address)
        return "unresolved: no matching instruction; showing address only"
    address = head
    function = ida_funcs.get_func(address)
    if function is None:
        ida_kernwin.jumpto(address)
        return "unresolved: no containing function; showing address"
    try:
        import ida_hexrays
        if not ida_hexrays.init_hexrays_plugin():
            raise RuntimeError("Hex-Rays unavailable")
        view = ida_hexrays.open_pseudocode(address, 0)
        if not view:
            raise RuntimeError("No pseudocode for this function")
        mapping = view.cfunc.get_eamap()
        nearest = bundle_io.nearest_mapping(address, mapping.keys(), lambda ea: function.contains(ea))
        if nearest is not None:
            for item in mapping[nearest]:
                coords = view.cfunc.find_item_coords(item)
                if coords and coords[0] >= 0 and coords[1] >= 0:
                    x, y = coords
                    place = ida_kernwin.simpleline_place_t()
                    place.n = y
                    if ida_kernwin.jumpto(view.ct, place, x, y):
                        return "pseudocode-nearest: reconstructed code, not source stepping"
        ida_kernwin.jumpto(function.start_ea)
        return "function-exact: no mapped pseudocode item; showing function entry"
    except (ImportError, RuntimeError, AttributeError, TypeError) as failure:
        ida_kernwin.jumpto(address)
        return "instruction fallback: " + str(failure)


class HotspotChooser(ida_kernwin.Choose):
    def __init__(self, bundle, rows):
        super().__init__("Hardware Explorer — modeled hotspots (Preview)", [
            ["Function", 30], ["RVA", 12], ["L1D misses", 12, ida_kernwin.Choose.CHCOL_DEC],
            ["Accesses", 12, ida_kernwin.Choose.CHCOL_DEC], ["Miss rate", 12],
            ["Estimated stall cycles", 18, ida_kernwin.Choose.CHCOL_DEC], ["Navigation", 35]])
        self.bundle = bundle
        self.rows = rows
        self.status = {}

    def OnGetSize(self):
        return len(self.rows)

    def OnGetLine(self, index):
        address, site = self.rows[index]
        function = ida_funcs.get_func(address)
        metrics = site["metrics"]
        return [ida_funcs.get_func_name(address) if function else "Unresolved function", site["location"]["rva"],
                str(metrics["l1dMisses"]), str(metrics["accesses"]), f'{metrics["l1dMissRate"]:.2%}',
                str(metrics["estimatedMemoryStallCycles"]), self.status.get(index, "function-exact" if function else "unresolved")]

    def OnSelectLine(self, index):
        # Recheck the active IDB on every navigation, not just on initial import.
        current = bundle_io.map_sites(self.bundle, ida_nalt.retrieve_input_file_sha256(), ida_nalt.get_imagebase())
        if current != self.rows:
            ida_kernwin.warning("The image base/database changed. Reimport before navigating.")
            return (ida_kernwin.Choose.NOTHING_CHANGED,)
        self.status[index] = navigate(self.rows[index][0], self.bundle['capture']['kind'])
        ida_kernwin.msg("Hardware Explorer: " + self.status[index] + "\n")
        return (ida_kernwin.Choose.ALL_CHANGED,)


class HardwareExplorerPlugin(ida_idaapi.plugin_t):
    flags = ida_idaapi.PLUGIN_KEEP
    comment = "Import local, identity-checked modeled cache hotspots"
    help = "Ghidra/IDA hotspot bundle v1; experimental IDA adapter"
    wanted_name = "Hardware Explorer (Preview)"
    wanted_hotkey = ""

    def init(self):
        self.chooser = None
        return ida_idaapi.PLUGIN_KEEP

    def run(self, arg):
        path = ida_kernwin.ask_file(False, "*.json", "Open Hardware Explorer hotspot bundle")
        if not path:
            return
        try:
            if ida_ida.inf_is_64bit() or ida_ida.inf_get_procname() != "metapc":
                raise ValueError("Expected a 32-bit x86 program")
            bundle = bundle_io.read_bundle(path)
            rows = bundle_io.map_sites(bundle, ida_nalt.retrieve_input_file_sha256(), ida_nalt.get_imagebase())
            image = next(image for image in bundle["images"] if image["sha256"] == ida_nalt.retrieve_input_file_sha256().hex())
            if "codeView" in image:
                original = ida_kernwin.ask_file(False, "*.exe;*.dll", "Select the original PE for CodeView identity verification (read only)")
                if not original:
                    return
                bundle_io.verify_codeview(original, image["sha256"], image["codeView"])
            # Strong SHA match is mandatory. No weak filename/timestamp fallback.
            # No automatic symbol lookup or target-file/network access.
            for address, site in rows:
                head = ida_bytes.get_item_head(address)
                if not ida_bytes.is_code(ida_bytes.get_full_flags(head)):
                    continue
                if bundle["capture"]["kind"] == "intel-pin" and head != address:
                    continue
                metrics = site["metrics"]
                note = f'modeled L1D misses={metrics["l1dMisses"]}, accesses={metrics["accesses"]}; ranked subset, not measured'
                old = ida_bytes.get_cmt(head, False)
                ida_bytes.set_cmt(head, bundle_io.update_annotation(old, note), False)
            for warning in bundle["warnings"]:
                ida_kernwin.msg("Hardware Explorer: " + warning + "\n")
            ida_kernwin.msg(f'Hardware Explorer model: {bundle["profile"]}; capture: {bundle["capture"]}\n')
            if self.chooser:
                self.chooser.Close()
            self.chooser = HotspotChooser(bundle, rows)
            self.chooser.Show()
        except Exception as failure:
            ida_kernwin.warning("Hardware Explorer import failed: " + str(failure))

    def term(self):
        if self.chooser:
            self.chooser.Close()


def PLUGIN_ENTRY():
    return HardwareExplorerPlugin()
