// Import local modeled cache hotspots and navigate to reconstructed pseudocode.
// @category Hardware Explorer
import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import ghidra.app.script.GhidraScript;
import ghidra.app.tablechooser.*;
import ghidra.app.services.GoToService;
import ghidra.app.decompiler.*;
import ghidra.app.decompiler.component.DecompilerUtils;
import ghidra.app.decompiler.location.DefaultDecompilerLocation;
import ghidra.app.plugin.core.decompile.DecompilerProvider;
import ghidra.app.util.pdb.PdbProgramAttributes;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.util.ProgramLocation;
import ghidra.util.task.TaskMonitor;
import ghidra.util.Swing;

public class HardwareExplorer extends GhidraScript {
    public static final String CATEGORY = "Hardware Explorer Preview";
    private record Row(Address address, JsonObject site, String function, String confidence) implements AddressableRowObject {
        public Address getAddress() { return address; }
    }
    @Override public void run() throws Exception {
        if (currentProgram == null) throw new IllegalArgumentException("Open a PE32 program first.");
        String[] args = getScriptArgs();
        if (args.length > 0 && args[0].equals("clear")) {
            currentProgram.getBookmarkManager().removeBookmarks(BookmarkType.NOTE, CATEGORY, monitor);
            println("Removed Hardware Explorer markers only. Program bytes and other bookmarks are unchanged."); return;
        }
        Path bundlePath = args.length > 0 ? Path.of(args[0]) : askFile("Open Hardware Explorer hotspot bundle", "Open").toPath();
        Path schemaPath = args.length > 1 ? Path.of(args[1]) : Path.of(getSourceFile().getParentFile().getAbsolutePath(), "hotspots.schema.json");
        HardwareExplorerBundle bundle = HardwareExplorerBundle.read(bundlePath, schemaPath);
        List<Row> rows = prepare(bundle);
        // Validation completes before any existing markers are touched.
        currentProgram.getBookmarkManager().removeBookmarks(BookmarkType.NOTE, CATEGORY, monitor);
        long maxMisses = rows.stream().mapToLong(row -> metric(row, "l1dMisses")).max().orElse(0);
        for (Row row : rows) {
            monitor.checkCancelled();
            if (!currentProgram.getMemory().contains(row.address())) continue;
            long misses = metric(row, "l1dMisses");
            String severity = maxMisses == 0 ? "low" : misses >= maxMisses * .5 ? "high" : misses >= maxMisses * .1 ? "medium" : "low";
            currentProgram.getBookmarkManager().setBookmark(row.address(), BookmarkType.NOTE, CATEGORY,
                severity + " | modeled L1D misses=" + misses + " accesses=" + metric(row, "accesses") +
                " | RVA=" + row.site().getAsJsonObject("location").get("rva").getAsString() + " | " + row.confidence() + " | ranked subset; not measured");
        }
        println("Imported " + rows.size() + " ranked sites. Image SHA-256 verified. Model: " + bundle.json.getAsJsonObject("profile") + ". Capture: " + bundle.json.getAsJsonObject("capture"));
        for (JsonElement warning : bundle.json.getAsJsonArray("warnings")) println(warning.getAsString());
        if (isRunningHeadless()) return;
        Address importedBase = currentProgram.getImageBase();
        TableChooserDialog dialog = createTableChooserDialog("Hardware Explorer — modeled cache hotspots (Preview)", new TableChooserExecutor() {
            private long navigationSequence;
            public String getButtonName() { return "Open pseudocode"; }
            public boolean execute(AddressableRowObject object) {
                Row row = (Row)object;
                try {
                    if (currentProgram.isClosed() || !currentProgram.getImageBase().equals(importedBase)) throw new IllegalStateException("Program closed or rebased; reimport before navigating.");
                    Program program = currentProgram;
                    Swing.runNow(() -> {
                        long request = ++navigationSequence;
                        var tool = state.getTool();
                        var provider = tool.getComponentProvider("Decompiler");
                        if (!(provider instanceof DecompilerProvider decompiler)) throw new IllegalStateException("Enable Ghidra's Decompiler window, then retry.");
                        tool.showComponentProvider(provider, true);
                        if (!tool.getService(GoToService.class).goTo(decompiler, new ProgramLocation(program, row.address()), program)) throw new IllegalStateException("Decompiler refused navigation");
                        decompiler.doWhenNotBusy(() -> {
                            if (request != navigationSequence || program.isClosed() || !program.getImageBase().equals(importedBase)) return;
                            var panel = decompiler.getDecompilerPanel();
                            Function function = program.getFunctionManager().getFunctionContaining(row.address());
                            // Use the displayed markup, including the user's formatting options.
                            // A separate DecompInterface can produce different token coordinates.
                            if (panel.getController().getProgram() != program || !Objects.equals(function, panel.getController().getFunction())) return;
                            ClangToken token = program.getListing().getInstructionAt(row.address()) == null ? null : nearestToken(panel.getLines(), function, row.address());
                            if (token != null) {
                                panel.goToToken(token);
                                println("pseudocode-nearest: reconstructed code, not original source or stepping.");
                            } else {
                                goTo(row.address());
                                println(row.confidence() + ": no pseudocode mapping; showing the instruction/function instead.");
                            }
                        });
                    });
                } catch (Exception failure) { printerr("Navigation failed: " + failure.getMessage()); }
                return false;
            }
        });
        dialog.addCustomColumn(new StringColumnDisplay() {
            public String getColumnName() { return "Function"; }
            public String getColumnValue(AddressableRowObject row) { return ((Row)row).function(); }
        });
        dialog.addCustomColumn(new StringColumnDisplay() {
            public String getColumnName() { return "RVA / navigation"; }
            public String getColumnValue(AddressableRowObject object) { Row row = (Row)object; return row.site().getAsJsonObject("location").get("rva").getAsString() + " / " + row.confidence(); }
        });
        for (String name : List.of("l1dMisses", "accesses", "estimatedMemoryStallCycles", "l1dMissRate")) {
            dialog.addCustomColumn(new AbstractComparableColumnDisplay<Double>() {
                public Class<Double> getColumnClass() { return Double.class; }
                public String getColumnName() { return name; }
                public Double getColumnValue(AddressableRowObject row) { return ((Row)row).site().getAsJsonObject("metrics").get(name).getAsDouble(); }
            });
        }
        rows.sort(Comparator.comparingLong((Row row) -> metric(row, "l1dMisses")).reversed());
        for (Row row : rows) dialog.add(row);
        dialog.setMessage("SHA-256 verified · modeled / ranked subset · select a row and Open pseudocode. Double-click shows its instruction.");
        dialog.show();
    }
    private static long metric(Row row, String name) { return row.site().getAsJsonObject("metrics").get(name).getAsLong(); }
    private List<Row> prepare(HardwareExplorerBundle bundle) throws Exception {
        HardwareExplorerBundle.require(currentProgram.getDefaultPointerSize() == 4 && currentProgram.getLanguage().getProcessor().toString().equalsIgnoreCase("x86"), "Expected a 32-bit x86 program");
        String hash = currentProgram.getExecutableSHA256();
        HardwareExplorerBundle.require(hash != null && hash.matches("(?i)[0-9a-f]{64}"), "The Ghidra program has no trustworthy imported-file SHA-256");
        JsonObject image = bundle.imageForHash(hash);
        if (image.has("codeView")) {
            PdbProgramAttributes pdb = new PdbProgramAttributes(currentProgram);
            JsonObject cv = image.getAsJsonObject("codeView");
            String actual = pdb.getPdbGuid();
            HardwareExplorerBundle.require(actual != null && actual.replace("{", "").replace("}", "").equalsIgnoreCase(cv.get("guid").getAsString()) &&
                pdb.getPdbAge() != null && Long.parseLong(pdb.getPdbAge(), 16) == cv.get("age").getAsLong(), "CodeView GUID/age mismatch or missing metadata. No annotations were applied.");
        }
        List<Row> rows = new ArrayList<>();
        for (JsonElement value : bundle.json.getAsJsonArray("codeHotspots")) {
            JsonObject site = value.getAsJsonObject();
            if (!site.getAsJsonObject("location").get("imageId").equals(image.get("id"))) continue;
            Address address = currentProgram.getImageBase().addNoWrap(HardwareExplorerBundle.rva(site.getAsJsonObject("lookup")));
            Instruction instruction = currentProgram.getListing().getInstructionContaining(address);
            boolean pin = bundle.json.getAsJsonObject("capture").get("kind").getAsString().equals("intel-pin");
            if (pin && instruction != null && !instruction.getAddress().equals(address)) instruction = null;
            Function function = instruction == null ? null : currentProgram.getFunctionManager().getFunctionContaining(address);
            if (instruction != null) address = instruction.getAddress();
            rows.add(new Row(address, site, function == null ? "Unresolved function" : function.getName(), function != null ? "function-exact" : instruction != null ? "instruction-exact" : "unresolved"));
        }
        return rows;
    }
    /** Verified function-only token search; never cross into an adjacent function. */
    public static ClangToken nearestToken(List<ClangLine> lines, Function function, Address address) {
        if (function == null || lines == null) return null;
        ClangToken nearest = null; long distance = Long.MAX_VALUE;
        for (ClangLine line : lines) {
            for (ClangToken token : line.getAllTokens()) {
                Address min = token.getMinAddress(), max = token.getMaxAddress();
                if (min != null && function.getBody().contains(min)) {
                    long delta = max != null && address.compareTo(min) >= 0 && address.compareTo(max) <= 0 ? 0 : Math.abs(min.subtract(address));
                    if (delta < distance) { distance = delta; nearest = token; }
                }
            }
        }
        return nearest;
    }
    /** Headless equivalent, with zero-based FieldPanel coordinates. GUI uses its own tokens. */
    public static ProgramLocation pseudocodeLocation(Program program, Address address, TaskMonitor monitor) throws Exception {
        Function function = program.getFunctionManager().getFunctionContaining(address);
        if (function == null || program.getListing().getInstructionAt(address) == null) return null;
        DecompInterface decompiler = new DecompInterface();
        try {
            if (!decompiler.openProgram(program)) return null;
            DecompileResults results = decompiler.decompileFunction(function, 30, monitor);
            if (!results.decompileCompleted() || results.getCCodeMarkup() == null) return null;
            ClangToken nearest = nearestToken(DecompilerUtils.toLines(results.getCCodeMarkup()), function, address);
            if (nearest == null) return null;
            ClangLine line = nearest.getLineParent();
            int column = 0;
            for (ClangToken token : line.getAllTokens()) {
                if (token == nearest) break;
                column += token.getText().length();
            }
            return new DefaultDecompilerLocation(program, address, new DecompilerLocationInfo(function.getEntryPoint(), results, nearest, line.getLineNumber() - 1, column));
        } finally { decompiler.dispose(); }
    }
}
