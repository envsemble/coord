# Code capture

A code capture is a class diagram of declarations read through a compiler from explicit source scopes. Coord does not run repository scripts, execute application code, emit classes or enable Java annotation processors. Syntax and configuration errors fail the capture; unavailable dependencies and declared types outside the scope give partial coverage with diagnostics. Runtime composition, framework persistence mappings and reflection stay outside every capture. [Diagrams](diagrams.md#captures) describes the `coord capture` command and what a capture holds.

| Adapter    | Toolchain                                                                                                                                    | Facts and limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | The bundled TypeScript **6.0.3 compiler API**, the classic JavaScript compiler. The development type check uses TypeScript 7 separately.     | An explicit tsconfig; named classes, interfaces, enums and type aliases, their own properties (also constructor parameter properties) and method, constructor and call signatures, explicit inheritance and implementation, and type references. Dependencies must be installed. Project references are partial until captured explicitly. Anonymous and function-local declarations are left out with diagnostics; merged declarations stay separate, numbered elements with partial coverage. |
| Java       | A **JDK 21 or newer** on PATH (or `java` naming its launcher); the standard compiler trees and elements with `-proc:none` and `--release 21` | Explicit source files and an optional local classpath; named classes, interfaces, enums, records and nested declarations, their own fields, methods and constructors, and declared inheritance, implementation and type uses. Generated sources may be selected as ordinary files. Build tools and JPA are not run. External types and the provenance of classpath directories are partial.                                                                                                     |

The capture records the compiler's actual version. TypeScript 7's package exports version metadata rather than the classic compiler API, so Coord packages the 6.0.3 compiler as `typescript-compiler`; it does not claim to read syntax newer than that.

## How code becomes a class diagram

- Classes, abstract classes, interfaces and enums keep their kind; records are classes and annotation types interfaces. A type alias is a class whose snippet shows its definition.
- Attributes keep their declared type; an optional property is `[0..1]`. Methods and constructors keep their parameters and return types. Visibility is drawn where it is declared (Java members without a modifier are package-private, `~`, an interface's public, `+`); `static`, `readonly` and the other modifiers are not drawn. An enum shows its constants; a Java enum's fields and methods are left out.
- `extends` and `implements` are inheritance and implementation. UML has no class implementing a class or interface extending a class, which TypeScript allows; those are dependencies labelled `implements` or `extends`. Every other declared type use is an unlabelled dependency, `..>`.
- A TypeScript project's folders are packages (under the project's identity when a capture has several projects); Java packages are packages. A nested declaration is named by its owner, `Outer.Inner`.
- Names are PlantUML names: the simple name where it is unique, else the qualified name, else numbered, with other characters replaced by `_`. Member names keep their own characters where PlantUML allows them.

Each declaration's evidence is its file relative to its repository, its lines, the repository and, when the selected files are tracked and their text matches the HEAD blob (allowing for Git's line-ending normalization, and including edits hidden from `git status`), the commit and a link pinned to it. Its snippet is up to twelve lines of the declaration. Each member's evidence is its line.

Up to eight distinctly identified projects make one capture. TypeScript links declarations across the projects; Java compiles each project separately. The header keeps the selected scope, the Git revision where there is one, the content, configuration and dependency fingerprints, the capture date, coverage and limitations. Source files are read again before the capture is written and must not have changed.

Bounds: 200 selected files or 8 MiB of source text, 500 declarations, 4,000 members; TypeScript's compiler inputs stop at 1,000 files or 32 MiB. Java classpaths take at most 100 entries and 32 MiB of files, checked again after compiling; directory provenance is partial. Java compilation uses a 512 MiB heap, a 30-second timeout and an 8 MiB output bound.

## Configuration

```json
{
  "formatVersion": 1,
  "adapter": "typescript",
  "identity": "architecture",
  "projects": [
    { "identity": "api", "path": "api", "tsconfig": "tsconfig.json" },
    { "identity": "client", "path": "client" }
  ]
}
```

```json
{
  "formatVersion": 1,
  "adapter": "java",
  "identity": "harbor",
  "projects": [
    {
      "identity": "harbor",
      "path": "harbor",
      "files": [
        "src/main/java/example/User.java",
        "src/main/java/example/Enrollment.java"
      ],
      "classpath": ["dependencies/domain.jar"]
    }
  ]
}
```

Project paths are relative to the configuration file; files, tsconfig and classpath are relative to their project and must stay inside it. `repositoryUrl` names the repository's web address for links when its Git remote `origin` should not. See [the configuration schema](../packages/diagrams/schemas/code-source-schema.json). The library's `captureTypeScript`, `captureJava` and `captureFromConfig` return the diagram's text. Compiler API references: [TypeScript](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API), [Java JavacTask](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.compiler/com/sun/source/util/JavacTask.html).
