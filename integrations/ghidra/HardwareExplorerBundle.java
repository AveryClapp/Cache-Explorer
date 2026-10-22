// Pure bundle validation; no Ghidra database or target-file access.
import com.google.gson.*;
import com.google.gson.stream.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.math.BigDecimal;
import java.util.*;
import java.util.regex.Pattern;

public final class HardwareExplorerBundle {
    private static final int MAX_BYTES = 16 * 1024 * 1024;
    public final JsonObject json;
    private HardwareExplorerBundle(JsonObject json) { this.json = json; }
    public static HardwareExplorerBundle read(Path path, Path schemaPath) throws Exception {
        JsonElement input = readJson(path);
        JsonObject schema = readJson(schemaPath).getAsJsonObject();
        check(input, schema, schema, "bundle");
        HardwareExplorerBundle bundle = new HardwareExplorerBundle(input.getAsJsonObject());
        bundle.checkIdentityAndMetrics();
        return bundle;
    }
    private static JsonElement readJson(Path path) throws Exception {
        byte[] bytes;
        try (InputStream input = Files.newInputStream(path)) { bytes = input.readNBytes(MAX_BYTES + 1); }
        require(bytes.length <= MAX_BYTES, "File exceeds 16 MiB");
        var decoder = StandardCharsets.UTF_8.newDecoder();
        try (JsonReader reader = new JsonReader(new InputStreamReader(new ByteArrayInputStream(bytes), decoder))) {
            reader.setStrictness(Strictness.STRICT);
            JsonElement result = readNode(reader, 0, new int[]{0});
            require(reader.peek() == JsonToken.END_DOCUMENT, "Trailing JSON content");
            return result;
        }
    }
    private static JsonElement readNode(JsonReader reader, int depth, int[] nodes) throws Exception {
        require(depth <= 32 && ++nodes[0] <= 500000, "JSON nesting or node limit exceeded");
        switch (reader.peek()) {
        case BEGIN_OBJECT:
            JsonObject object = new JsonObject(); reader.beginObject();
            while (reader.hasNext()) {
                String key = reader.nextName();
                require(key.length() <= 4096 && !object.has(key), "Oversized or duplicate JSON key");
                object.add(key, readNode(reader, depth + 1, nodes));
            }
            reader.endObject(); return object;
        case BEGIN_ARRAY:
            JsonArray array = new JsonArray(); reader.beginArray();
            while (reader.hasNext()) array.add(readNode(reader, depth + 1, nodes));
            reader.endArray(); return array;
        case STRING:
            String text = reader.nextString(); require(text.length() <= 4096, "JSON string exceeds limit");
            return new JsonPrimitive(text);
        case NUMBER: return new JsonPrimitive(new BigDecimal(reader.nextString()));
        case BOOLEAN: return new JsonPrimitive(reader.nextBoolean());
        case NULL: reader.nextNull(); return JsonNull.INSTANCE;
        default: throw new IllegalArgumentException("Invalid JSON token");
        }
    }
    // Deliberately limited to the keywords in the shipped, trusted v1 schema.
    // Consumers reject all unknown fields; schemas from bundles are never loaded.
    private static void check(JsonElement value, JsonObject spec, JsonObject root, String at) {
        if (spec.has("$ref")) {
            String ref = spec.get("$ref").getAsString();
            require(ref.startsWith("#/definitions/"), "Only local schema definitions are supported");
            check(value, root.getAsJsonObject("definitions").getAsJsonObject(ref.substring(14)), root, at); return;
        }
        if (spec.has("anyOf")) {
            for (JsonElement alternative : spec.getAsJsonArray("anyOf")) {
                try { check(value, alternative.getAsJsonObject(), root, at); return; }
                catch (IllegalArgumentException ignored) { }
            }
            throw new IllegalArgumentException(at + ": no permitted value type");
        }
        if (spec.has("const")) require(value.equals(spec.get("const")), at + ": unsupported value/version");
        if (spec.has("enum")) require(spec.getAsJsonArray("enum").contains(value), at + ": unsupported enum");
        String type = spec.has("type") ? spec.get("type").getAsString() : "";
        switch (type) {
        case "object":
            require(value.isJsonObject(), at + ": expected object");
            JsonObject object = value.getAsJsonObject();
            if (spec.has("maxProperties")) require(object.size() <= spec.get("maxProperties").getAsInt(), at + ": too many properties");
            if (spec.has("required")) for (JsonElement key : spec.getAsJsonArray("required")) require(object.has(key.getAsString()), at + ": missing " + key.getAsString());
            JsonObject properties = spec.has("properties") ? spec.getAsJsonObject("properties") : new JsonObject();
            for (var entry : object.entrySet()) {
                if (spec.has("propertyNames")) check(new JsonPrimitive(entry.getKey()), spec.getAsJsonObject("propertyNames"), root, at);
                if (properties.has(entry.getKey())) check(entry.getValue(), properties.getAsJsonObject(entry.getKey()), root, at + "." + entry.getKey());
                else {
                    JsonElement additional = spec.get("additionalProperties");
                    require(additional != null && additional.isJsonObject(), at + ": unexpected field");
                    check(entry.getValue(), additional.getAsJsonObject(), root, at);
                }
            }
            break;
        case "array":
            require(value.isJsonArray(), at + ": expected array");
            int length = value.getAsJsonArray().size();
            if (spec.has("minItems")) require(length >= spec.get("minItems").getAsInt(), at + ": empty list");
            if (spec.has("maxItems")) require(length <= spec.get("maxItems").getAsInt(), at + ": list exceeds limit");
            for (JsonElement child : value.getAsJsonArray()) check(child, spec.getAsJsonObject("items"), root, at + "[]");
            break;
        case "string":
            require(value.isJsonPrimitive() && value.getAsJsonPrimitive().isString(), at + ": expected string");
            String text = value.getAsString();
            if (spec.has("minLength")) require(text.length() >= spec.get("minLength").getAsInt(), at + ": empty string");
            if (spec.has("maxLength")) require(text.length() <= spec.get("maxLength").getAsInt(), at + ": string exceeds limit");
            if (spec.has("pattern")) require(Pattern.compile(spec.get("pattern").getAsString()).matcher(text).find(), at + ": invalid string");
            break;
        case "integer": case "number":
            require(value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber(), at + ": expected number");
            BigDecimal number = value.getAsBigDecimal();
            if (type.equals("integer")) require(number.stripTrailingZeros().scale() <= 0, at + ": expected integer");
            if (spec.has("minimum")) require(number.compareTo(spec.get("minimum").getAsBigDecimal()) >= 0, at + ": number too small");
            if (spec.has("maximum")) require(number.compareTo(spec.get("maximum").getAsBigDecimal()) <= 0, at + ": number too large");
            break;
        case "boolean": require(value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean(), at + ": expected boolean"); break;
        }
        // propertyNames uses pattern without an explicit type in JSON Schema.
        if (type.isEmpty() && spec.has("pattern")) require(Pattern.compile(spec.get("pattern").getAsString()).matcher(value.getAsString()).find(), at + ": invalid property name");
    }
    private void checkIdentityAndMetrics() {
        Map<String, JsonObject> images = new HashMap<>();
        for (JsonElement value : json.getAsJsonArray("images")) {
            JsonObject image = value.getAsJsonObject(); String id = string(image, "id");
            require(id.equals("sha256:" + string(image, "sha256")) && images.put(id, image) == null, "Duplicate or inconsistent image identity");
        }
        boolean clang = string(json.getAsJsonObject("capture"), "kind").equals("clang-cl");
        Set<String> sites = new HashSet<>();
        JsonArray hotspots = json.getAsJsonArray("codeHotspots");
        require(number(json.getAsJsonObject("coverage"), "returnedSites") == hotspots.size(), "Inconsistent coverage");
        for (JsonElement value : hotspots) {
            JsonObject site = value.getAsJsonObject(), location = site.getAsJsonObject("location"), lookup = site.getAsJsonObject("lookup"), metrics = site.getAsJsonObject("metrics");
            String id = string(location, "imageId"); long rva = rva(location), expected = clang ? rva - 1 : rva;
            require(images.containsKey(id) && rva < number(images.get(id), "imageSize") && expected >= 0 && sites.add(id + ":" + rva), "Unknown image, invalid RVA or duplicate site");
            require(rva(lookup) == expected && string(lookup, "method").equals(clang ? "return-pc-minus-one" : "instruction-pc"), "Wrong capture lookup mode");
            require(string(site, "navigationConfidence").equals("unresolved") != site.has("symbol"), "Confidence disagrees with symbols");
            if (site.has("symbol")) require(Long.parseLong(string(site.getAsJsonObject("symbol"), "functionRva").substring(2), 16) <= expected, "Function starts after site");
            long accesses = number(metrics, "accesses"), misses = number(metrics, "l1dMisses");
            require(number(metrics, "reads") + number(metrics, "writes") == accesses && number(metrics, "l1dHits") + misses == accesses, "Inconsistent metric counts");
            require(Math.abs(metrics.get("l1dMissRate").getAsDouble() - (accesses == 0 ? 0 : (double)misses / accesses)) <= .00011, "Inconsistent miss rate");
        }
    }
    public JsonObject imageForHash(String hash) {
        for (JsonElement value : json.getAsJsonArray("images")) if (string(value.getAsJsonObject(), "sha256").equalsIgnoreCase(hash)) return value.getAsJsonObject();
        throw new IllegalArgumentException("Binary SHA-256 mismatch: no matching image in the bundle. No annotations were applied.");
    }
    public static String string(JsonObject value, String key) { return value.get(key).getAsString(); }
    public static long number(JsonObject value, String key) { return value.get(key).getAsLong(); }
    public static long rva(JsonObject value) { return Long.parseLong(string(value, "rva").substring(2), 16); }
    public static void require(boolean condition, String message) { if (!condition) throw new IllegalArgumentException(message); }
}
