const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { execFileSync, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { randomUUID } = require("node:crypto");
const {
  fingerprint,
  createSnapshot,
  createDocument,
} = require("../document/document.cjs");
const { emptyModel, sourceOptions } = require("./database.cjs");
const BOUNDS = {
  files: 200,
  bytes: 8 * 1024 * 1024,
  declarations: 500,
  members: 4000,
};
const slash = (value) => value.replaceAll("\\", "/");
function contained(root, file) {
  const resolved = fs.realpathSync(file),
    relative = path.relative(fs.realpathSync(root), resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("CAPTURE_SCOPE: source file escapes selected project");
  return resolved;
}
function gitInfo(root, sources, repositoryUrl) {
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      maxBuffer: BOUNDS.bytes + 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    const top = git("rev-parse", "--show-toplevel"),
      revision = git("rev-parse", "HEAD");
    const selected = [...sources.keys()].map((file) =>
      slash(path.relative(root, file)),
    );
    const dirty = !!git(
      "status",
      "--porcelain",
      "--untracked-files=normal",
      "--",
      ...selected,
    );
    let tracked = true;
    try {
      git("ls-files", "--error-unmatch", "--", ...selected);
    } catch {
      tracked = false;
    }
    let url = repositoryUrl;
    if (!url) {
      try {
        url = git("remote", "get-url", "origin")
          .replace(/^git@([^:]+):/, "https://$1/")
          .replace(/\.git$/, "");
      } catch {}
    }
    if (url) {
      const parsed = new URL(url);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      )
        url = null;
    }
    let exact = !dirty && tracked;
    if (exact)
      for (const [file, text] of sources) {
        const relative = slash(path.relative(top, file));
        // Git status can hide edits through assume-unchanged/skip-worktree.
        const blob = execFileSync(
          "git",
          ["-C", root, "show", `${revision}:${relative}`],
          {
            encoding: "utf8",
            windowsHide: true,
            timeout: 5000,
            maxBuffer: BOUNDS.bytes + 1024,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        if (blob.replaceAll("\r\n", "\n") !== text.replaceAll("\r\n", "\n")) {
          exact = false;
          break;
        }
      }
    return { revision, pinned: exact, top, url };
  } catch {
    return { revision: null, pinned: false, url: null };
  }
}
function readSelected(root, files) {
  if (files.length > BOUNDS.files)
    throw new Error("CAPTURE_LIMIT: source scope exceeds 200 files");
  const sources = new Map();
  let bytes = 0;
  for (const file of files) {
    const absolute = contained(root, file);
    if (sources.has(absolute))
      throw new Error("CAPTURE_SCOPE: duplicate source file");
    bytes += fs.statSync(absolute).size;
    if (bytes > BOUNDS.bytes)
      throw new Error("CAPTURE_LIMIT: source scope exceeds 8 MiB");
    sources.set(absolute, fs.readFileSync(absolute, "utf8"));
  }
  if (
    sources.size > BOUNDS.files ||
    [...sources.values()].reduce(
      (total, text) => total + Buffer.byteLength(text),
      0,
    ) > BOUNDS.bytes
  )
    throw new Error("CAPTURE_LIMIT: source scope exceeds 200 files or 8 MiB");
  return sources;
}
function verifySources(sources) {
  for (const [file, text] of sources)
    if (fs.readFileSync(file, "utf8") !== text)
      throw new Error(
        "CAPTURE_INCONSISTENT: a source file changed during capture",
      );
}
function projectEvidence(
  project,
  sources,
  nodes,
  evidence,
  snippets,
  language,
) {
  const info = gitInfo(project.path, sources, project.repositoryUrl);
  for (const node of nodes) {
    const file = path.resolve(project.path, node.location.file),
      text = sources.get(file);
    if (text === undefined)
      throw new Error("CAPTURE_SOURCE: declaration source is unavailable");
    const startLine = node.location.startLine,
      endLine = Math.min(node.location.endLine, startLine + 11);
    const sourceId = `code-source:${node.id}`,
      relative = slash(path.relative(info.top || project.path, file));
    const url =
      info.pinned && info.url
        ? `${info.url}${new URL(info.url).hostname === "github.com" ? "/blob/" : "/-/blob/"}${info.revision}/${relative.split("/").map(encodeURIComponent).join("/")}#L${startLine}`
        : undefined;
    const repo = info.url
      ? new URL(info.url).pathname.replace(/^\//, "")
      : project.identity;
    const commit = info.pinned ? info.revision : undefined;
    evidence.sources.push({
      id: sourceId,
      file: relative,
      repo,
      ...(commit ? { commit } : {}),
      line: startLine,
      title: `${node.name} declaration`,
      claim:
        "Observed compiler declaration in captured source; no runtime or OntoUML interpretation.",
      ...(url ? { url } : {}),
    });
    evidence.elements[node.id] = {
      status: "observed",
      evidence: [sourceId],
      primarySource: sourceId,
    };
    snippets[sourceId] = {
      language,
      startLine,
      endLine,
      code: text
        .split(/\r?\n/)
        .slice(startLine - 1, endLine)
        .join("\n"),
      ...(url ? { url } : {}),
      repo,
      ...(commit ? { commit } : {}),
      file: relative,
    };
  }
  return {
    identity: project.identity,
    scope: [...sources.keys()]
      .map((file) => slash(path.relative(project.path, file)))
      .sort(),
    revision: info.revision,
    pinnedSelectedFiles: info.pinned,
    contentFingerprint: fingerprint(
      [...sources]
        .map(([file, text]) => [
          slash(path.relative(project.path, file)),
          fingerprint(text),
        ])
        .sort(),
    ),
  };
}
function finishCode(
  options,
  model,
  diagnostics,
  projects,
  evidence,
  snippets,
  adapter,
) {
  if (
    model.nodes.length > BOUNDS.declarations ||
    model.nodes.reduce(
      (n, node) => n + node.attributes.length + (node.methods?.length || 0),
      0,
    ) > BOUNDS.members ||
    Buffer.byteLength(JSON.stringify(model)) > BOUNDS.bytes
  )
    throw new Error(
      "CAPTURE_LIMIT: code model exceeds 500 declarations, 4000 members or 8 MiB",
    );
  for (const key of ["nodes", "relations", "generalizations"])
    model[key].sort((a, b) => a.id.localeCompare(b.id, "en"));
  const capture = {
    capturedAt: new Date().toISOString(),
    adapter: {
      id: `atlas-${adapter.id}`,
      version: "1.0.0",
      compilerVersion: adapter.version,
    },
    source: {
      kind: adapter.id,
      identity: options.identity,
      scope: projects.flatMap((p) =>
        p.scope.map((file) => p.identity + ":" + file),
      ),
      projects,
    },
    coverage: {
      status: diagnostics.length ? "partial" : "complete",
      diagnostics,
    },
    consistency: {
      kind: "compiler-read-with-content-recheck",
      metadataOnly: true,
    },
    limitations: [
      "Named declarations and declared type use only; no runtime/reflection/framework mappings or conceptual multiplicities are inferred.",
    ],
    schemaFingerprint: fingerprint(model),
  };
  evidence.unknowns = [
    ...capture.limitations,
    ...diagnostics.map((d) => d.message),
  ];
  const snapshot = createSnapshot({ profile: "code", model, capture });
  return createDocument({
    id: `capture-${randomUUID()}`,
    title: options.title || `${options.identity} classes`,
    profile: "code",
    state: "snapshot",
    model,
    evidence,
    snippets,
    snapshots: [snapshot],
    baselineId: snapshot.id,
    ...(options.workId ? { workId: options.workId } : {}),
  });
}
function optionsCheck(options) {
  sourceOptions(options);
  if (
    !Array.isArray(options.projects) ||
    !options.projects.length ||
    options.projects.length > 8 ||
    new Set(options.projects.map((p) => p.identity)).size !==
      options.projects.length
  )
    throw new Error(
      "CAPTURE_CONFIG: select up to eight distinctly identified projects",
    );
  for (const project of options.projects) {
    sourceOptions(project);
  }
}
async function captureTypeScript(options) {
  options = {
    ...options,
    projects: options.projects?.map((p) => ({
      ...p,
      path: fs.realpathSync(p.path),
    })),
  };
  optionsCheck(options);
  const ts = require("typescript-compiler");
  if (ts.version !== "6.0.3")
    throw new Error(
      "CAPTURE_VERSION: TypeScript 6.0.3 compiler API is required",
    );
  const model = emptyModel(),
    diagnostics = [],
    evidence = { sources: [], elements: {} },
    snippets = {},
    projects = [],
    pending = [],
    symbols = new Map(),
    declarationIds = new Map();
  let totalFiles = 0,
    totalBytes = 0;
  for (const project of options.projects) {
    const configFile = contained(
      project.path,
      path.resolve(project.path, project.tsconfig || "tsconfig.json"),
    );
    const configText = fs.readFileSync(configFile, "utf8");
    const config = ts.readConfigFile(configFile, ts.sys.readFile);
    if (config.error)
      throw new Error(
        "CAPTURE_CONFIG: TypeScript configuration cannot be read",
      );
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      path.dirname(configFile),
    );
    if (parsed.errors.length || !parsed.fileNames.length)
      throw new Error(
        "CAPTURE_CONFIG: TypeScript scope/configuration is unavailable",
      );
    if (parsed.projectReferences?.length)
      diagnostics.push({
        code: "PROJECT_REFERENCES",
        message: `${project.identity}: referenced projects must be captured explicitly; generated declaration resolution only.`,
      });
    const sources = readSelected(project.path, parsed.fileNames);
    totalFiles += sources.size;
    totalBytes += [...sources.values()].reduce(
      (n, s) => n + Buffer.byteLength(s),
      0,
    );
    if (totalFiles > BOUNDS.files || totalBytes > BOUNDS.bytes)
      throw new Error("CAPTURE_LIMIT: combined source scope exceeds limits");
    const compilerOptions = {
      ...parsed.options,
      noEmit: true,
      incremental: false,
    };
    const host = ts.createCompilerHost(compilerOptions);
    const readFile = host.readFile.bind(host),
      inputs = new Map();
    let inputBytes = 0;
    host.readFile = (file) => {
      if (!host.fileExists(file)) return undefined;
      const real = fs.realpathSync(file);
      if (inputs.has(real)) return inputs.get(real);
      inputBytes += fs.statSync(real).size;
      if (inputs.size >= 1000 || inputBytes > 32 * 1024 * 1024)
        throw new Error(
          "CAPTURE_LIMIT: compiler inputs exceed 1000 files or 32 MiB before parsing",
        );
      const text = readFile(real);
      inputs.set(real, text);
      return text;
    };
    const program = ts.createProgram({
      rootNames: [...sources.keys()],
      options: compilerOptions,
      host,
    });
    if (
      program.getSyntacticDiagnostics().length ||
      program.getOptionsDiagnostics().length
    )
      throw new Error(
        "CAPTURE_SYNTAX: TypeScript syntax/options errors prevent capture",
      );
    const checker = program.getTypeChecker();
    for (const error of program.getSemanticDiagnostics().slice(0, 200))
      diagnostics.push({
        code: "COMPILER_DIAGNOSTIC",
        message: `${project.identity}: TS${error.code} ${ts.flattenDiagnosticMessageText(error.messageText, " ").slice(0, 1000)}`,
      });
    if (config.config.extends)
      diagnostics.push({
        code: "CONFIG_EXTENDS",
        message: `${project.identity}: inherited compiler configuration is resolved but its source provenance is not retained.`,
      });
    const located = [];
    const declarationCounts = new Map();
    const visit = (node, owner = "") => {
      if (ts.isFunctionLike(node)) {
        const containsDeclaration = (part) => {
          if (
            ts.isClassDeclaration(part) ||
            ts.isInterfaceDeclaration(part) ||
            ts.isTypeAliasDeclaration(part) ||
            ts.isEnumDeclaration(part)
          )
            diagnostics.push({
              code: "LOCAL_DECLARATION",
              message: `${project.identity}: function-local declaration excluded`,
            });
          else ts.forEachChild(part, containsDeclaration);
        };
        ts.forEachChild(node, containsDeclaration);
        return;
      }
      const declaration =
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isTypeAliasDeclaration(node);
      if (declaration && node.name) {
        const source = node.getSourceFile(),
          file = slash(path.relative(project.path, source.fileName)),
          qualified = owner ? `${owner}.${node.name.text}` : node.name.text;
        const baseId = `code:ts:${encodeURIComponent(project.identity)}:${encodeURIComponent(file)}:${encodeURIComponent(qualified)}`;
        const declarationOrdinal = declarationCounts.get(baseId) || 0;
        declarationCounts.set(baseId, declarationOrdinal + 1);
        const id = declarationOrdinal
          ? `${baseId}:declaration:${declarationOrdinal}`
          : baseId;
        const location = {
          file,
          startLine:
            source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          endLine: source.getLineAndCharacterOfPosition(node.end).line + 1,
        };
        const modifiers = (item) =>
          (item.modifiers || []).map(
            (m) => ts.tokenToString(m.kind) || ts.SyntaxKind[m.kind],
          );
        const ownMembers = node.members || [];
        const attributes = [],
          methods = [];
        const counts = new Map();
        for (const member of ownMembers) {
          const name =
            member.name?.getText(source) ||
            (ts.isConstructorDeclaration(member) ? "constructor" : "call");
          const method =
            ts.isMethodDeclaration(member) ||
            ts.isMethodSignature(member) ||
            ts.isConstructorDeclaration(member) ||
            ts.isCallSignatureDeclaration(member) ||
            ts.isConstructSignatureDeclaration(member);
          const signature = method
            ? checker.signatureToString(
                checker.getSignatureFromDeclaration(member),
              )
            : checker.typeToString(checker.getTypeAtLocation(member));
          const key = `${method ? "method" : "field"}:${name}:${method ? (member.parameters || []).map((p) => p.type?.getText(source) || "inferred").join(",") : ""}`,
            ordinal = counts.get(key) || 0;
          counts.set(key, ordinal + 1);
          const data = {
            id: `${id}:${encodeURIComponent(key)}:${ordinal}`,
            name,
            type: method ? `${name}${signature}` : signature,
            modifiers: modifiers(member),
            optional: !!member.questionToken,
            location: {
              file,
              startLine:
                source.getLineAndCharacterOfPosition(member.getStart()).line +
                1,
              endLine:
                source.getLineAndCharacterOfPosition(member.end).line + 1,
            },
          };
          (method ? methods : attributes).push(data);
          if (ts.isConstructorDeclaration(member))
            for (const parameter of member.parameters) {
              if (!ts.isParameterPropertyDeclaration(parameter, member))
                continue;
              const propertyName = parameter.name.getText(source);
              attributes.push({
                ...data,
                id: `${id}:${encodeURIComponent(`field:${propertyName}:`)}:0`,
                name: propertyName,
                type: checker.typeToString(
                  checker.getTypeAtLocation(parameter),
                ),
                modifiers: modifiers(parameter),
                optional: !!parameter.questionToken,
                location: {
                  file,
                  startLine:
                    source.getLineAndCharacterOfPosition(parameter.getStart())
                      .line + 1,
                  endLine:
                    source.getLineAndCharacterOfPosition(parameter.end).line +
                    1,
                },
              });
            }
        }
        const kind = ts.isClassDeclaration(node)
          ? "class"
          : ts.isInterfaceDeclaration(node)
            ? "interface"
            : ts.isEnumDeclaration(node)
              ? "enum"
              : "type alias";
        const fact = {
          id,
          name: qualified,
          kind,
          attributes,
          methods,
          location,
          abstract: !!node.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.AbstractKeyword,
          ),
          ...(ts.isTypeAliasDeclaration(node)
            ? { definition: node.type.getText(source) }
            : {}),
        };
        model.nodes.push(fact);
        located.push(fact);
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbols.has(symbol))
          diagnostics.push({
            code: "MERGED_DECLARATION",
            message: `${project.identity}:${qualified}: declaration merging is retained as separate source declarations`,
            elementId: id,
          });
        else if (symbol) symbols.set(symbol, id);
        declarationIds.set(
          `${fs.realpathSync(source.fileName)}:${node.pos}:${node.end}`,
          id,
        );
        pending.push({ node, id, checker, ts, project });
        if (ts.isClassDeclaration(node))
          for (const member of node.members) visit(member, qualified);
        return;
      }
      if (
        ts.isClassExpression(node) ||
        (ts.isClassDeclaration(node) && !node.name)
      ) {
        diagnostics.push({
          code: "ANONYMOUS_DECLARATION",
          message: `${project.identity}: anonymous class excluded`,
        });
        return;
      }
      ts.forEachChild(node, (child) =>
        visit(
          child,
          ts.isModuleDeclaration(node)
            ? (owner ? owner + "." : "") + node.name.text
            : owner,
        ),
      );
    };
    for (const file of program.getSourceFiles())
      if (sources.has(fs.realpathSync(file.fileName))) visit(file);
    if (fs.readFileSync(configFile, "utf8") !== configText)
      throw new Error(
        "CAPTURE_INCONSISTENT: configuration changed during capture",
      );
    const dependencies = program.getSourceFiles();
    if (
      dependencies.length > 1000 ||
      dependencies.reduce((n, f) => n + Buffer.byteLength(f.text), 0) >
        32 * 1024 * 1024
    )
      throw new Error(
        "CAPTURE_LIMIT: compiler dependency scope exceeds 1000 files or 32 MiB",
      );
    for (const file of dependencies)
      if (fs.readFileSync(file.fileName, "utf8") !== file.text)
        throw new Error(
          "CAPTURE_INCONSISTENT: compiler inputs changed during capture",
        );
    verifySources(sources);
    projects.push({
      ...projectEvidence(
        project,
        sources,
        located,
        evidence,
        snippets,
        "typescript",
      ),
      tsconfig: slash(path.relative(project.path, configFile)),
      configurationFingerprint: fingerprint(configText),
      dependencyFingerprint: fingerprint(
        dependencies
          .map((f) => [
            slash(path.relative(project.path, f.fileName)),
            fingerprint(f.text),
          ])
          .sort(),
      ),
    });
  }
  const edgeIds = new Set();
  for (const { node, id, checker, ts, project } of pending) {
    const resolve = (target) => {
      let symbol = checker.getSymbolAtLocation(target);
      if (symbol?.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
      const typeSymbol = checker.getTypeAtLocation(target).symbol;
      return (
        symbols.get(symbol) ||
        symbols.get(typeSymbol) ||
        (symbol?.declarations || typeSymbol?.declarations || [])
          .map((d) =>
            declarationIds.get(
              `${fs.realpathSync(d.getSourceFile().fileName)}:${d.pos}:${d.end}`,
            ),
          )
          .find(Boolean)
      );
    };
    for (const clause of node.heritageClauses || [])
      for (const parent of clause.types) {
        const target = resolve(parent.expression);
        if (target) {
          const realization = clause.token === ts.SyntaxKind.ImplementsKeyword;
          model.generalizations.push({
            id: `${id}:${realization ? "implements" : "extends"}:${target}`,
            specificId: id,
            generalId: target,
            realization,
          });
        } else
          diagnostics.push({
            code: "EXTERNAL_TYPE",
            message: `${project.identity}:${node.name.text}: inheritance target ${parent.getText()} is outside captured declarations`,
            elementId: id,
          });
      }
    const typeUse = (part) => {
      if (ts.isTypeReferenceNode(part) || ts.isTypeQueryNode(part)) {
        const target = resolve(part.typeName || part.exprName),
          name = part.getText();
        if (target && target !== id) {
          const edgeId = `${id}:uses:${target}`;
          if (!edgeIds.has(edgeId)) {
            edgeIds.add(edgeId);
            model.relations.push({
              id: edgeId,
              name: "declared type use",
              stereotype: "dependency",
              sourceId: id,
              targetId: target,
              sourceMultiplicity: "?",
              targetMultiplicity: "?",
            });
          }
        } else if (
          !target &&
          !checker.getTypeAtLocation(part).isTypeParameter?.()
        )
          diagnostics.push({
            code: "EXTERNAL_TYPE",
            message: `${project.identity}:${node.name.text}: type reference ${name} has no captured target`,
            elementId: id,
          });
      }
      ts.forEachChild(part, typeUse);
    };
    for (const member of node.members || []) {
      if (member.type) typeUse(member.type);
      for (const parameter of member.typeParameters || []) {
        if (parameter.constraint) typeUse(parameter.constraint);
        if (parameter.default) typeUse(parameter.default);
      }
      for (const parameter of member.parameters || [])
        if (parameter.type) typeUse(parameter.type);
    }
    if (ts.isTypeAliasDeclaration(node)) typeUse(node.type);
    for (const parameter of node.typeParameters || []) {
      if (parameter.constraint) typeUse(parameter.constraint);
      if (parameter.default) typeUse(parameter.default);
    }
    for (const clause of node.heritageClauses || [])
      for (const parent of clause.types)
        for (const argument of parent.typeArguments || []) typeUse(argument);
  }
  return finishCode(options, model, diagnostics, projects, evidence, snippets, {
    id: "typescript",
    version: ts.version,
  });
}
async function captureJava(options) {
  options = {
    ...options,
    projects: options.projects?.map((p) => ({
      ...p,
      path: fs.realpathSync(p.path),
    })),
  };
  optionsCheck(options);
  const executable = options.java || "java";
  try {
    execFileSync(executable, ["-version"], {
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
  } catch (error) {
    if (error.status !== undefined)
      throw new Error("CAPTURE_PREREQUISITE: a Java 21 JDK is required");
    throw new Error("CAPTURE_PREREQUISITE: a Java 21 JDK is required");
  }
  const model = emptyModel(),
    diagnostics = [],
    evidence = { sources: [], elements: {} },
    snippets = {},
    projects = [];
  let totalFiles = 0,
    totalBytes = 0,
    compilerVersion;
  for (const project of options.projects) {
    if (
      !Array.isArray(project.files) ||
      !project.files.length ||
      project.files.some((file) => !file.endsWith(".java"))
    )
      throw new Error("CAPTURE_CONFIG: select explicit Java source files");
    const sources = readSelected(
      project.path,
      project.files.map((file) => path.resolve(project.path, file)),
    );
    totalFiles += sources.size;
    totalBytes += [...sources.values()].reduce(
      (n, s) => n + Buffer.byteLength(s),
      0,
    );
    if (totalFiles > BOUNDS.files || totalBytes > BOUNDS.bytes)
      throw new Error("CAPTURE_LIMIT: combined source scope exceeds limits");
    if ((project.classpath || []).length > 100)
      throw new Error("CAPTURE_LIMIT: at most 100 classpath entries");
    const classpath = (project.classpath || []).map((file) =>
      contained(project.path, path.resolve(project.path, file)),
    );
    if (
      classpath.reduce(
        (n, file) =>
          n + (fs.statSync(file).isFile() ? fs.statSync(file).size : 0),
        0,
      ) >
      32 * 1024 * 1024
    )
      throw new Error("CAPTURE_LIMIT: classpath files exceed 32 MiB");
    const dependencyState = () =>
      classpath.map((file) => [
        slash(path.relative(project.path, file)),
        fs.statSync(file).isFile()
          ? fingerprint(fs.readFileSync(file).toString("base64"))
          : "directory (dependency contents unverified)",
      ]);
    const dependenciesBefore = fingerprint(dependencyState());
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-java-")),
      request = path.join(temp, "request.txt");
    try {
      const emptyClasspath = path.join(temp, "empty-classpath");
      fs.mkdirSync(emptyClasspath);
      fs.writeFileSync(
        request,
        [
          project.path,
          classpath.length ? classpath.join(path.delimiter) : emptyClasspath,
          ...sources.keys(),
        ]
          .map((line) => Buffer.from(line).toString("base64"))
          .join("\n"),
      );
      const { stdout } = await promisify(execFile)(
        executable,
        [
          "-Xmx512m",
          "--source",
          "21",
          path.join(__dirname, "java/AtlasJava.java"),
          request,
        ],
        { windowsHide: true, timeout: 30000, maxBuffer: BOUNDS.bytes },
      );
      const result = JSON.parse(stdout);
      if (result.error) throw new Error(result.error);
      compilerVersion = result.version;
      const prefix = `code:java:${encodeURIComponent(project.identity)}:`;
      const id = (name) => prefix + encodeURIComponent(name);
      const nodes = result.nodes.map((node) => ({
        ...node,
        id: id(node.id),
        attributes: node.attributes.map((a) => ({ ...a, id: id(a.id) })),
        methods: node.methods.map((m) => ({ ...m, id: id(m.id) })),
      }));
      model.nodes.push(...nodes);
      model.generalizations.push(
        ...result.generalizations.map((g) => ({
          ...g,
          id: id(g.id),
          specificId: id(g.specificId),
          generalId: id(g.generalId),
        })),
      );
      model.relations.push(
        ...result.relations.map((r) => ({
          ...r,
          id: id(r.id),
          sourceId: id(r.sourceId),
          targetId: id(r.targetId),
          sourceMultiplicity: "?",
          targetMultiplicity: "?",
        })),
      );
      diagnostics.push(
        ...result.diagnostics.map((d) => ({
          ...d,
          message: project.identity + ": " + d.message,
          ...(d.elementId ? { elementId: id(d.elementId) } : {}),
        })),
      );
      verifySources(sources);
      if (fingerprint(dependencyState()) !== dependenciesBefore)
        throw new Error(
          "CAPTURE_INCONSISTENT: classpath files changed during capture",
        );
      projects.push({
        ...projectEvidence(project, sources, nodes, evidence, snippets, "java"),
        classpathFingerprint: dependenciesBefore,
      });
      if (classpath.some((file) => fs.statSync(file).isDirectory()))
        diagnostics.push({
          code: "CLASSPATH_DIRECTORY",
          message: `${project.identity}: classpath directory contents are not fingerprinted; dependency provenance is partial`,
        });
    } catch (error) {
      if (error.message.startsWith("CAPTURE_")) throw error;
      throw new Error(
        "CAPTURE_JAVA: compiler inspection failed; check JDK 21 and source/classpath configuration",
      );
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  // Separately compiled projects preserve identities; cross-project targets require a later explicit mapping.
  return finishCode(options, model, diagnostics, projects, evidence, snippets, {
    id: "java",
    version: compilerVersion,
  });
}
async function captureCodeFromConfig(workspace, file, workId) {
  let config;
  try {
    config = JSON.parse(workspace.readFile(file).replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(
      "CAPTURE_CONFIG: code configuration is unavailable or malformed",
    );
  }
  const validate = new (require("ajv/dist/2020"))({ strict: false }).compile(
    require("../../schemas/code-source-schema.json"),
  );
  if (!validate(config))
    throw new Error(
      "CAPTURE_CONFIG: source configuration does not match code-source v1",
    );
  const options = {
    ...config,
    ...(workId ? { workId } : {}),
    projects: config.projects.map((project) => ({
      ...project,
      path: workspace.resolve(path.join(path.dirname(file), project.path)),
    })),
  };
  return config.adapter === "typescript"
    ? captureTypeScript(options)
    : captureJava(options);
}
module.exports = { captureTypeScript, captureJava, captureCodeFromConfig };
