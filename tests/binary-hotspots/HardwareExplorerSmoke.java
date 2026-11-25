// Headless checks against a repository-built, real PE32 image.
// @category Hardware Explorer.Tests
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompilerLocation;
import ghidra.program.model.listing.*;
import java.nio.file.*;
import com.google.gson.*;
import ghidra.app.util.pdb.PdbProgramAttributes;

public class HardwareExplorerSmoke extends GhidraScript {
    private void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    @Override public void run() throws Exception {
        String[] args = getScriptArgs();
        String[] importArgs = { args[0], args[1] };
        var originalBase = currentProgram.getImageBase();
        runScript("HardwareExplorer.java", importArgs);
        check(currentProgram.getBookmarkManager().getBookmark(originalBase.add(0x1015), BookmarkType.NOTE, HardwareExplorer.CATEGORY) != null, "Missing original marker");
        var location = HardwareExplorer.pseudocodeLocation(currentProgram, originalBase.add(0x1015), monitor);
        check(location instanceof DecompilerLocation && ((DecompilerLocation)location).getToken() != null, "No real pseudocode token navigation");
        DecompilerLocation navigation = (DecompilerLocation)location;
        check(navigation.getLineNumber() == navigation.getToken().getLineParent().getLineNumber() - 1, "Pseudocode line must be zero-based for FieldPanel navigation");
        int column = 0;
        for (var token : navigation.getToken().getLineParent().getAllTokens()) {
            if (token == navigation.getToken()) break;
            column += token.getText().length();
        }
        check(navigation.getCharPos() == column, "Token column must exclude visual indentation");
        println("Pseudocode token: " + ((DecompilerLocation)location).getToken().getText());
        currentProgram.setImageBase(toAddr(0x710000), true);
        runScript("HardwareExplorer.java", importArgs);
        check(currentProgram.getBookmarkManager().getBookmark(toAddr(0x711015), BookmarkType.NOTE, HardwareExplorer.CATEGORY) != null, "Rebased RVA did not follow current image base");
        location = HardwareExplorer.pseudocodeLocation(currentProgram, toAddr(0x711015), monitor);
        check(location instanceof DecompilerLocation, "Rebased pseudocode navigation failed");
        JsonObject wrong = JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonObject();
        // CodeView is available from PE metadata even with no PDB loaded.
        PdbProgramAttributes pdb = new PdbProgramAttributes(currentProgram);
        check(pdb.getPdbGuid() != null, "Fixture lacks CodeView identity");
        JsonObject cv = new JsonObject();
        cv.addProperty("guid", pdb.getPdbGuid().replace("{", "").replace("}", "").toLowerCase());
        cv.addProperty("age", Long.parseLong(pdb.getPdbAge(), 16));
        Files.writeString(Path.of(args[0]).resolveSibling("ghidra-codeview.json"), cv.toString());
        wrong.getAsJsonArray("images").get(0).getAsJsonObject().add("codeView", cv);
        Path cvBundle = Files.createTempFile("hardware-explorer-codeview", ".json");
        try {
            Files.writeString(cvBundle, wrong.toString());
            runScript("HardwareExplorer.java", new String[]{cvBundle.toString(), args[1]});
            cv.addProperty("age", cv.get("age").getAsLong() + 1);
            Files.writeString(cvBundle, wrong.toString());
            boolean rejected = false;
            try { runScript("HardwareExplorer.java", new String[]{cvBundle.toString(), args[1]}); }
            catch (IllegalArgumentException expected) { rejected = expected.getMessage().contains("GUID/age"); }
            check(rejected, "CodeView mismatch accepted");
        } finally { Files.deleteIfExists(cvBundle); }
        wrong.getAsJsonArray("images").get(0).getAsJsonObject().remove("codeView");
        JsonObject image = wrong.getAsJsonArray("images").get(0).getAsJsonObject();
        String sha = "c".repeat(64); image.addProperty("sha256", sha); image.addProperty("id", "sha256:" + sha);
        for (JsonElement site : wrong.getAsJsonArray("codeHotspots")) site.getAsJsonObject().getAsJsonObject("location").addProperty("imageId", "sha256:" + sha);
        Path bad = Files.createTempFile("hardware-explorer-mismatch", ".json");
        try {
            Files.writeString(bad, wrong.toString());
            boolean rejected = false;
            try { runScript("HardwareExplorer.java", new String[]{bad.toString(), args[1]}); }
            catch (IllegalArgumentException expected) { rejected = expected.getMessage().contains("SHA-256 mismatch"); }
            check(rejected, "Mismatched binary was not rejected");
            check(currentProgram.getBookmarkManager().getBookmark(toAddr(0x711015), BookmarkType.NOTE, HardwareExplorer.CATEGORY) != null, "Failed import removed prior markers");
        } finally { Files.deleteIfExists(bad); }
        currentProgram.getBookmarkManager().setBookmark(toAddr(0x711015), BookmarkType.NOTE, "User note", "keep me");
        runScript("HardwareExplorer.java", new String[]{"clear"});
        check(currentProgram.getBookmarkManager().getBookmark(toAddr(0x711015), BookmarkType.NOTE, HardwareExplorer.CATEGORY) == null, "Own marker was not cleared");
        check(currentProgram.getBookmarkManager().getBookmark(toAddr(0x711015), BookmarkType.NOTE, "User note") != null, "User bookmark was removed");
        println("HARDWARE_EXPLORER_GHIDRA_SMOKE_PASS");
    }
}
