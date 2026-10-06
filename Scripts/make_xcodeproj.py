#!/usr/bin/env python3
"""Génère ShowLumiere.xcodeproj (fichier projet Xcode) à partir des fichiers du dossier.

À relancer si on ajoute ou retire un fichier .swift :  python3 Scripts/make_xcodeproj.py
(Xcode, lui, met le fichier à jour tout seul quand on crée un fichier depuis Xcode.)
"""
import hashlib
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PROJ = os.path.join(ROOT, "ShowLumiere.xcodeproj")
APP_DIR = "ShowLumiere"
TARGET = "ShowLumiere"
PRODUCT = "Show lumière"
BUNDLE_ID = "fr.showlumiere.mac"
VERSION = "2.0.0"
DEPLOYMENT = "14.0"


def oid(key):
    return hashlib.md5(("showlumiere:" + key).encode("utf-8")).hexdigest()[:24].upper()


def q(value):
    s = str(value)
    if s != "" and re.fullmatch(r"[A-Za-z0-9_./$]+", s):
        return s
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def dump(value, level=0):
    pad = "\t" * level
    inner = "\t" * (level + 1)
    if isinstance(value, dict):
        out = "{\n"
        for k, v in value.items():
            out += f"{inner}{q(k)} = {dump(v, level + 1)};\n"
        return out + pad + "}"
    if isinstance(value, (list, tuple)):
        out = "(\n"
        for v in value:
            out += f"{inner}{dump(v, level + 1)},\n"
        return out + pad + ")"
    return q(value)


objects = {}


def add(key, **fields):
    i = oid(key)
    objects[i] = fields
    return i


# ── fichiers ──
swift_files = sorted(f for f in os.listdir(os.path.join(ROOT, APP_DIR)) if f.endswith(".swift"))
if not swift_files:
    sys.exit("Aucun fichier .swift trouvé dans " + APP_DIR)
if not os.path.exists(os.path.join(ROOT, APP_DIR, "Resources", "AppIcon.icns")):
    sys.exit("AppIcon.icns manquant dans " + APP_DIR + "/Resources")

swift_refs, swift_builds = [], []
for f in swift_files:
    ref = add("ref:" + f, isa="PBXFileReference", lastKnownFileType="sourcecode.swift", path=f, sourceTree="<group>")
    swift_refs.append(ref)
    swift_builds.append(add("build:" + f, isa="PBXBuildFile", fileRef=ref))

icon_ref = add("ref:AppIcon.icns", isa="PBXFileReference", lastKnownFileType="image.icns", path="AppIcon.icns", sourceTree="<group>")
icon_build = add("build:AppIcon.icns", isa="PBXBuildFile", fileRef=icon_ref)

info_ref = add("ref:Info.plist", isa="PBXFileReference", lastKnownFileType="text.plist.xml", path="Info.plist", sourceTree="<group>")
ent_ref = add("ref:ShowLumiere.entitlements", isa="PBXFileReference", lastKnownFileType="text.plist.entitlements", path="ShowLumiere.entitlements", sourceTree="<group>")
node_ent_ref = add("ref:Node.entitlements", isa="PBXFileReference", lastKnownFileType="text.plist.entitlements", path="Node.entitlements", sourceTree="<group>")

embed_ref = add("ref:embed-server.sh", isa="PBXFileReference", lastKnownFileType="text.script.sh", path="embed-server.sh", sourceTree="<group>")
prep_ref = add("ref:preparer.command", isa="PBXFileReference", lastKnownFileType="text.script.sh", path="preparer.command", sourceTree="<group>")
comp_ref = add("ref:compiler.command", isa="PBXFileReference", lastKnownFileType="text.script.sh", path="compiler.command", sourceTree="<group>")

product_ref = add("ref:product", isa="PBXFileReference", explicitFileType="wrapper.application", includeInIndex=0, path=PRODUCT + ".app", sourceTree="BUILT_PRODUCTS_DIR")

# ── groupes ──
res_group = add("group:Resources", isa="PBXGroup", children=[icon_ref], path="Resources", sourceTree="<group>")
app_group = add("group:app", isa="PBXGroup", children=swift_refs + [res_group], path=APP_DIR, sourceTree="<group>")
cfg_group = add("group:Config", isa="PBXGroup", children=[info_ref, ent_ref, node_ent_ref], path="Config", sourceTree="<group>")
scr_group = add("group:Scripts", isa="PBXGroup", children=[embed_ref, prep_ref, comp_ref], path="Scripts", sourceTree="<group>")
prod_group = add("group:Products", isa="PBXGroup", children=[product_ref], name="Products", sourceTree="<group>")
main_group = add("group:main", isa="PBXGroup", children=[app_group, cfg_group, scr_group, prod_group], sourceTree="<group>")

# ── étapes de compilation ──
sources_phase = add("phase:sources", isa="PBXSourcesBuildPhase", buildActionMask=2147483647, files=swift_builds, runOnlyForDeploymentPostprocessing=0)
frameworks_phase = add("phase:frameworks", isa="PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
resources_phase = add("phase:resources", isa="PBXResourcesBuildPhase", buildActionMask=2147483647, files=[icon_build], runOnlyForDeploymentPostprocessing=0)
script_phase = add(
    "phase:script",
    isa="PBXShellScriptBuildPhase",
    alwaysOutOfDate=1,
    buildActionMask=2147483647,
    files=[],
    inputFileListPaths=[],
    inputPaths=[],
    name="Embarquer Node et le serveur",
    outputFileListPaths=[],
    outputPaths=[],
    runOnlyForDeploymentPostprocessing=0,
    shellPath="/bin/sh",
    shellScript='/bin/bash "${SRCROOT}/Scripts/embed-server.sh"\n',
)

# ── réglages ──
project_common = {
    "ALWAYS_SEARCH_USER_PATHS": "NO",
    "CLANG_ENABLE_MODULES": "YES",
    "CLANG_ENABLE_OBJC_ARC": "YES",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES",
    "ENABLE_USER_SCRIPT_SANDBOXING": "NO",
    "MACOSX_DEPLOYMENT_TARGET": DEPLOYMENT,
    "SDKROOT": "macosx",
}
project_debug = dict(project_common, **{
    "COPY_PHASE_STRIP": "NO",
    "DEBUG_INFORMATION_FORMAT": "dwarf",
    "ENABLE_TESTABILITY": "YES",
    "GCC_OPTIMIZATION_LEVEL": "0",
    "ONLY_ACTIVE_ARCH": "YES",
    "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG",
    "SWIFT_OPTIMIZATION_LEVEL": "-Onone",
})
project_release = dict(project_common, **{
    "COPY_PHASE_STRIP": "NO",
    "DEBUG_INFORMATION_FORMAT": "dwarf-with-dsym",
    "SWIFT_COMPILATION_MODE": "wholemodule",
    "SWIFT_OPTIMIZATION_LEVEL": "-O",
})
target_common = {
    "ARCHS": "arm64",
    "CODE_SIGN_ENTITLEMENTS": "Config/ShowLumiere.entitlements",
    "CODE_SIGN_STYLE": "Automatic",
    "COMBINE_HIDPI_IMAGES": "YES",
    "CURRENT_PROJECT_VERSION": "1",
    "ENABLE_HARDENED_RUNTIME": "YES",
    "GENERATE_INFOPLIST_FILE": "NO",
    "INFOPLIST_FILE": "Config/Info.plist",
    "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/../Frameworks"],
    "MARKETING_VERSION": VERSION,
    "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE_ID,
    "PRODUCT_NAME": PRODUCT,
    "SWIFT_VERSION": "5.0",
}
target_debug = dict(target_common, **{"ENABLE_DEBUG_DYLIB": "NO"})
target_release = dict(target_common)

p_debug = add("cfg:project:Debug", isa="XCBuildConfiguration", buildSettings=project_debug, name="Debug")
p_release = add("cfg:project:Release", isa="XCBuildConfiguration", buildSettings=project_release, name="Release")
t_debug = add("cfg:target:Debug", isa="XCBuildConfiguration", buildSettings=target_debug, name="Debug")
t_release = add("cfg:target:Release", isa="XCBuildConfiguration", buildSettings=target_release, name="Release")

p_list = add("list:project", isa="XCConfigurationList", buildConfigurations=[p_debug, p_release], defaultConfigurationIsVisible=0, defaultConfigurationName="Release")
t_list = add("list:target", isa="XCConfigurationList", buildConfigurations=[t_debug, t_release], defaultConfigurationIsVisible=0, defaultConfigurationName="Release")

target = add(
    "target",
    isa="PBXNativeTarget",
    buildConfigurationList=t_list,
    buildPhases=[sources_phase, frameworks_phase, resources_phase, script_phase],
    buildRules=[],
    dependencies=[],
    name=TARGET,
    productName=TARGET,
    productReference=product_ref,
    productType="com.apple.product-type.application",
)

project = add(
    "project",
    isa="PBXProject",
    attributes={
        "BuildIndependentTargetsInParallel": 1,
        "LastSwiftUpdateCheck": 2600,
        "LastUpgradeCheck": 2600,
        "TargetAttributes": {target: {"CreatedOnToolsVersion": "26.0"}},
    },
    buildConfigurationList=p_list,
    compatibilityVersion="Xcode 14.0",
    developmentRegion="fr",
    hasScannedForEncodings=0,
    knownRegions=["fr", "en", "Base"],
    mainGroup=main_group,
    productRefGroup=prod_group,
    projectDirPath="",
    projectRoot="",
    targets=[target],
)

# ── vérification interne : chaque identifiant cité existe ──
text_ids = set(objects)
for i, fields in objects.items():
    blob = dump(fields)
    for m in re.findall(r"\b[0-9A-F]{24}\b", blob):
        if m not in text_ids:
            sys.exit(f"Référence cassée {m} dans {i}")

# ── écriture ──
os.makedirs(PROJ, exist_ok=True)
by_isa = {}
for i, fields in objects.items():
    by_isa.setdefault(fields["isa"], []).append((i, fields))

out = "// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n"
for isa in sorted(by_isa):
    out += f"\n/* Begin {isa} section */\n"
    for i, fields in sorted(by_isa[isa], key=lambda t: t[0]):
        out += f"\t\t{i} = {dump(fields, 2)};\n"
    out += f"/* End {isa} section */\n"
out += f"\t}};\n\trootObject = {project};\n}}\n"
with open(os.path.join(PROJ, "project.pbxproj"), "w", encoding="utf-8") as fh:
    fh.write(out)

# espace de travail
ws = os.path.join(PROJ, "project.xcworkspace")
os.makedirs(ws, exist_ok=True)
with open(os.path.join(ws, "contents.xcworkspacedata"), "w", encoding="utf-8") as fh:
    fh.write('<?xml version="1.0" encoding="UTF-8"?>\n<Workspace\n   version = "1.0">\n   <FileRef\n      location = "self:">\n   </FileRef>\n</Workspace>\n')

# schéma partagé : « Run » lance la version Release (la même que celle qu'on installera)
schemes = os.path.join(PROJ, "xcshareddata", "xcschemes")
os.makedirs(schemes, exist_ok=True)
ref = (
    f'<BuildableReference\n'
    f'                  BuildableIdentifier = "primary"\n'
    f'                  BlueprintIdentifier = "{target}"\n'
    f'                  BuildableName = "{PRODUCT}.app"\n'
    f'                  BlueprintName = "{TARGET}"\n'
    f'                  ReferencedContainer = "container:ShowLumiere.xcodeproj">\n'
    f'               </BuildableReference>'
)
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "2600"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            {ref}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES">
   </TestAction>
   <LaunchAction
      buildConfiguration = "Release"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         {ref}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         {ref}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
'''
with open(os.path.join(schemes, "ShowLumiere.xcscheme"), "w", encoding="utf-8") as fh:
    fh.write(scheme)

print(f"Projet généré : {PROJ}")
print(f"  {len(swift_files)} fichiers Swift, {len(objects)} objets")
