# Compiler snapshots

Atlas captures declarations from explicit source scopes and saves an immutable code baseline. It does not run repository scripts, execute application code, emit classes, or enable Java annotation processors. Syntax/configuration errors fail capture; unavailable dependencies and out-of-scope declared types produce partial coverage with diagnostics. OntoUML classification, runtime composition, framework persistence mappings and reflection are authored interpretations.

| Adapter    | Supported toolchain                                                                                                              | Facts and limits                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript | Bundled TypeScript **6.0.3 compiler API**, classic JavaScript compiler. The development type check uses TypeScript 7 separately. | Explicit tsconfig; named classes/interfaces/enums/type aliases, own properties and method/constructor signatures, explicit inheritance/implementation and type references. Dependencies must be installed. Project references are partial until selected explicitly. Anonymous and function-local declarations are excluded with diagnostics; merged interfaces retain separate identified declarations with partial coverage. |
| Java       | Java **21 JDK** on PATH; standard compiler trees/elements, `-proc:none`, `--release 21`                                          | Explicit source files and optional local dependency classpath; named classes/interfaces/enums/records and nested declarations, own fields/methods/constructors, declared inheritance/implementation/type uses. Available generated sources may be selected as ordinary files. JPA and build-tool execution are excluded. External types and classpath directory provenance are partial.                                        |

The adapter publishes its actual compiler version. TypeScript 7's stable package entry exports version metadata rather than the classic compiler API, so Atlas deliberately packages the 6.0.3 compiler as `typescript-compiler`; it does not pretend to support new TypeScript 7 syntax.

Code relationships say **declared type use**, with `?` at both ends. Implementation uses a dashed UML realization; inheritance uses a solid hollow triangle. Type aliases preserve their definition, rather than inventing a class implementation. Source locations and up to twelve exact lines accompany each declaration and remain usable offline. A repository link is commit-pinned only when the selected files are tracked and their captured text matches the HEAD blob (allowing Git line-ending normalization), including edits hidden from Git status. Otherwise the snapshot retains the working-tree content fingerprint and excerpt without a misleading pinned link.

Up to eight distinctly identified projects contribute one document. IDs include the project identity, so identical names stay distinct. TypeScript links resolved captured declarations across projects; Java projects are compiled separately and cross-project interpretations require explicit mappings. Selected scopes, Git revision where available, configuration/content/dependency fingerprints, capture date, coverage and limitations are retained. Source content is rechecked before snapshot creation. No automatic refresh changes an older capture.

Bounds: 200 selected files / 8 MiB source text, 500 declarations / 4,000 members / 8 MiB model; TypeScript dependencies additionally cap at 1,000 files / 32 MiB. Java classpaths cap at 100 entries and 32 MiB of files, rechecked after compilation; directory provenance is explicitly partial. Java compiler calls use a 512 MiB heap, 30-second timeout and 8 MiB output bound. Representative extraction target is ten seconds excluding first compiler/process startup and layout. Missing dependencies do not masquerade as a complete baseline. No inference of executable behavior is made from passing compiler checks.

## Configuration and tools

Use `atlas_capture_code` with `{"file":"code-source.json","workId":"work-0008"}` or `atlas capture_code --root ./workspace --input request.json`. Projects' paths are relative to the configuration file; selected files, tsconfig and classpath are relative to each project. Paths must remain within the configured workspace/project. See [the versioned configuration schema](../packages/diagrams/schemas/code-source-schema.json).

```json
{
  "formatVersion": 1,
  "adapter": "typescript",
  "identity": "architecture",
  "projects": [
    { "identity": "api", "path": "api", "tsconfig": "tsconfig.json" },
    { "identity": "client", "path": "client", "tsconfig": "tsconfig.json" }
  ]
}
```

```json
{
  "formatVersion": 1,
  "adapter": "java",
  "identity": "coord",
  "projects": [
    {
      "identity": "coord",
      "path": "coord",
      "files": [
        "src/main/java/example/User.java",
        "src/main/java/example/Enrollment.java"
      ],
      "classpath": ["dependencies/domain.jar"]
    }
  ]
}
```

The returned handle supports the same inspect/validate/prepare/export workflow as conceptual and database models. Human users can run this CLI and inspect the frozen result in the dashboard. A packaged consumer receives the Java inspector source and classic TypeScript compiler; a local JDK remains an explicit prerequisite. Compiler API references: [TypeScript](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API), [Java 21 JavacTask](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.compiler/com/sun/source/util/JavacTask.html).
