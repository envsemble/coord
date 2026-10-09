import com.sun.source.tree.*;
import com.sun.source.util.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import javax.lang.model.element.*;
import javax.lang.model.type.*;
import javax.tools.*;

/** Atlas-owned inspector. It parses/analyzes source, never emits or runs project classes/processors. */
public class AtlasJava {

  static String encode(Object value) {
    if (value == null) return "null";
    if (value instanceof String s) {
      StringBuilder b = new StringBuilder("\"");
      for (char c : s.toCharArray())
        switch (c) {
          case '"' -> b.append("\\\"");
          case '\\' -> b.append("\\\\");
          case '\n' -> b.append("\\n");
          case '\r' -> b.append("\\r");
          case '\t' -> b.append("\\t");
          default -> {
            if (c < 32) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
          }
        }
      return b.append('"').toString();
    }
    if (value instanceof Map<?, ?> m) {
      List<String> entries = new ArrayList<>();
      m.forEach((k, v) -> entries.add(encode(k.toString()) + ":" + encode(v)));
      return "{" + String.join(",", entries) + "}";
    }
    if (value instanceof Iterable<?> list) {
      List<String> entries = new ArrayList<>();
      list.forEach(v -> entries.add(encode(v)));
      return "[" + String.join(",", entries) + "]";
    }
    return value.toString();
  }

  static Map<String, Object> map(Object... items) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < items.length; i += 2) m.put(
      items[i].toString(),
      items[i + 1]
    );
    return m;
  }

  static class Inspector extends TreePathScanner<Void, Void> {

    final Trees trees;
    final Path root;
    final Set<String> captured;
    final Map<String, Map<String, Object>> nodes = new TreeMap<>();
    final List<Map<String, Object>> diagnostics = new ArrayList<>(),
      generalizations = new ArrayList<>(),
      relations = new ArrayList<>();
    final Set<String> edges = new HashSet<>();
    final List<Map<String, Object>> pending = new ArrayList<>();

    Inspector(Trees trees, Path root, Set<String> captured) {
      this.trees = trees;
      this.root = root;
      this.captured = captured;
    }

    Map<String, Object> location(TreePath path) {
      CompilationUnitTree unit = path.getCompilationUnit();
      long start = trees
          .getSourcePositions()
          .getStartPosition(unit, path.getLeaf()),
        end = trees.getSourcePositions().getEndPosition(unit, path.getLeaf());
      String file = root
        .relativize(Paths.get(unit.getSourceFile().toUri()))
        .toString()
        .replace('\\', '/');
      return map(
        "file",
        file,
        "startLine",
        unit.getLineMap().getLineNumber(Math.max(0, start)),
        "endLine",
        unit.getLineMap().getLineNumber(Math.max(0, end - 1))
      );
    }

    @Override
    public Void visitClass(ClassTree tree, Void unused) {
      TreePath current = getCurrentPath();
      Element raw = trees.getElement(current);
      if (
        !(raw instanceof TypeElement element) ||
        tree.getSimpleName().length() == 0
      ) {
        diagnostics.add(
          map(
            "code",
            "ANONYMOUS_DECLARATION",
            "message",
            "Anonymous/local unresolved declaration excluded"
          )
        );
        return null;
      }
      String id = element.getQualifiedName().toString();
      if (
        id.isEmpty() ||
        element.getNestingKind() == NestingKind.LOCAL ||
        element.getNestingKind() == NestingKind.ANONYMOUS
      ) {
        diagnostics.add(
          map("code", "LOCAL_DECLARATION", "message", "Local class excluded")
        );
        return null;
      }
      List<Map<String, Object>> attributes = new ArrayList<>(),
        methods = new ArrayList<>();
      List<Map<String, Object>> typeUses = new ArrayList<>();
      for (Tree member : tree.getMembers()) {
        TreePath p = new TreePath(current, member);
        long position = trees
          .getSourcePositions()
          .getStartPosition(p.getCompilationUnit(), member);
        long end = trees
          .getSourcePositions()
          .getEndPosition(p.getCompilationUnit(), member);
        if (position < 0 || end < 0) continue;
        Element field = trees.getElement(p);
        if (member instanceof VariableTree variable) {
          String name = variable.getName().toString();
          attributes.add(
            map(
              "id",
              id + ":field:" + name,
              "name",
              name,
              "type",
              field == null
                ? variable.getType().toString()
                : field.asType().toString(),
              "modifiers",
              variable
                .getModifiers()
                .getFlags()
                .stream()
                .map(Object::toString)
                .sorted()
                .toList(),
              "location",
              location(p)
            )
          );
          if (field != null) references(field.asType(), typeUses);
        }
        if (
          member instanceof MethodTree method &&
          field instanceof ExecutableElement executable
        ) {
          String name = method.getName().toString(),
            signature = executable.toString();
          methods.add(
            map(
              "id",
              id + ":method:" + signature,
              "name",
              name,
              "type",
              signature +
                " : " +
                executable.getReturnType() +
                (executable.getThrownTypes().isEmpty()
                  ? ""
                  : " throws " +
                    executable
                      .getThrownTypes()
                      .stream()
                      .map(Object::toString)
                      .reduce((a, b) -> a + ", " + b)
                      .orElse("")),
              "modifiers",
              method
                .getModifiers()
                .getFlags()
                .stream()
                .map(Object::toString)
                .sorted()
                .toList(),
              "location",
              location(p)
            )
          );
          references(executable.getReturnType(), typeUses);
          for (VariableElement parameter : executable.getParameters())
            references(parameter.asType(), typeUses);
          for (TypeMirror thrown : executable.getThrownTypes())
            references(thrown, typeUses);
          for (TypeParameterTree parameter : method.getTypeParameters())
            for (Tree bound : parameter.getBounds())
              references(
                trees.getTypeMirror(
                  new TreePath(new TreePath(p, parameter), bound)
                ),
                typeUses
              );
        }
      }
      Map<String, Object> fact = map(
        "id",
        id,
        "name",
        id,
        "kind",
        element.getKind().toString().toLowerCase(Locale.ROOT),
        "abstract",
        element.getModifiers().contains(Modifier.ABSTRACT),
        "attributes",
        attributes,
        "methods",
        methods,
        "location",
        location(current)
      );
      if (
        nodes.putIfAbsent(id, fact) != null
      ) throw new IllegalArgumentException("Duplicate qualified declaration");
      List<Map<String, Object>> parents = new ArrayList<>();
      for (TypeParameterTree parameter : tree.getTypeParameters())
        for (Tree bound : parameter.getBounds())
          references(
            trees.getTypeMirror(
              new TreePath(new TreePath(current, parameter), bound)
            ),
            typeUses
          );
      if (tree.getExtendsClause() != null) {
        TypeMirror parent = trees.getTypeMirror(
          new TreePath(current, tree.getExtendsClause())
        );
        if (
          parent instanceof DeclaredType d
        ) for (TypeMirror argument : d.getTypeArguments())
          references(argument, typeUses);
        parents.add(
          map(
            "target",
            parent instanceof DeclaredType d
              ? ((TypeElement) d.asElement()).getQualifiedName().toString()
              : tree.getExtendsClause().toString(),
            "realization",
            false
          )
        );
      }
      for (Tree iface : tree.getImplementsClause()) {
        TypeMirror parent = trees.getTypeMirror(new TreePath(current, iface));
        if (
          parent instanceof DeclaredType d
        ) for (TypeMirror argument : d.getTypeArguments())
          references(argument, typeUses);
        String name =
          parent instanceof DeclaredType d
            ? ((TypeElement) d.asElement()).getQualifiedName().toString()
            : iface.toString();
        parents.add(
          map(
            "target",
            name,
            "realization",
            element.getKind() != ElementKind.INTERFACE
          )
        );
      }
      pending.add(map("id", id, "parents", parents, "uses", typeUses));
      return super.visitClass(tree, unused);
    }

    void references(TypeMirror type, List<Map<String, Object>> uses) {
      if (type instanceof DeclaredType declared) {
        Element e = declared.asElement();
        if (e instanceof TypeElement t) uses.add(
          map("target", t.getQualifiedName().toString())
        );
        for (TypeMirror argument : declared.getTypeArguments())
          references(argument, uses);
      } else if (type instanceof ArrayType array) references(
        array.getComponentType(),
        uses
      );
      else if (type instanceof WildcardType wildcard) {
        if (wildcard.getExtendsBound() != null) references(
          wildcard.getExtendsBound(),
          uses
        );
        if (wildcard.getSuperBound() != null) references(
          wildcard.getSuperBound(),
          uses
        );
      } else if (type.getKind() == TypeKind.ERROR) diagnostics.add(
        map(
          "code",
          "UNRESOLVED_TYPE",
          "message",
          "Unresolved declared type: " + type
        )
      );
    }

    @SuppressWarnings("unchecked")
    void finish() {
      for (Map<String, Object> row : pending) {
        String id = (String) row.get("id");
        for (Map<String, Object> parent : (List<Map<String, Object>>) row.get(
          "parents"
        )) {
          String target = (String) parent.get("target");
          if (nodes.containsKey(target)) generalizations.add(
            map(
              "id",
              id + ":inherits:" + target,
              "specificId",
              id,
              "generalId",
              target,
              "realization",
              parent.get("realization")
            )
          );
          else diagnostics.add(
            map(
              "code",
              "EXTERNAL_TYPE",
              "message",
              id +
                ": inheritance target " +
                target +
                " is outside captured declarations",
              "elementId",
              id
            )
          );
        }
        for (Map<String, Object> use : (List<Map<String, Object>>) row.get(
          "uses"
        )) {
          String target = (String) use.get("target"),
            edge = id + ":uses:" + target;
          if (target.equals(id)) continue;
          if (nodes.containsKey(target) && edges.add(edge)) relations.add(
            map(
              "id",
              edge,
              "name",
              "declared type use",
              "stereotype",
              "dependency",
              "sourceId",
              id,
              "targetId",
              target
            )
          );
          else if (!nodes.containsKey(target)) diagnostics.add(
            map(
              "code",
              "EXTERNAL_TYPE",
              "message",
              id + ": declared type " + target + " has no captured target",
              "elementId",
              id
            )
          );
        }
      }
    }
  }

  public static void main(String[] args) throws Exception {
    if (Runtime.version().feature() != 21) {
      System.out.println(
        encode(map("error", "CAPTURE_VERSION: Java 21 JDK is required"))
      );
      return;
    }
    List<String> lines = Files.readAllLines(
      Path.of(args[0]),
      StandardCharsets.UTF_8
    )
      .stream()
      .map(line ->
        new String(Base64.getDecoder().decode(line), StandardCharsets.UTF_8)
      )
      .toList();
    Path root = Path.of(lines.get(0));
    String classpath = lines.get(1);
    List<String> files = lines.subList(2, lines.size());
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) {
      System.out.println(
        encode(map("error", "CAPTURE_PREREQUISITE: JDK compiler unavailable"))
      );
      return;
    }
    DiagnosticCollector<JavaFileObject> errors = new DiagnosticCollector<>();
    try (
      StandardJavaFileManager manager = compiler.getStandardFileManager(
        errors,
        Locale.ROOT,
        StandardCharsets.UTF_8
      )
    ) {
      List<String> options = new ArrayList<>(
        List.of(
          "-proc:none",
          "--release",
          "21",
          "-encoding",
          "UTF-8",
          "-implicit:none",
          "-sourcepath",
          ""
        )
      );
      options.addAll(
        List.of(
          "-classpath",
          classpath.isEmpty()
            ? root.resolve(".atlas-nonexistent-classpath").toString()
            : classpath
        )
      );
      JavacTask task = (JavacTask) compiler.getTask(
        new StringWriter(),
        manager,
        errors,
        options,
        null,
        manager.getJavaFileObjectsFromStrings(files)
      );
      List<CompilationUnitTree> units = new ArrayList<>();
      task.parse().forEach(units::add);
      if (
        errors
          .getDiagnostics()
          .stream()
          .anyMatch(d -> d.getKind() == Diagnostic.Kind.ERROR)
      ) {
        System.out.println(
          encode(
            map("error", "CAPTURE_SYNTAX: Java syntax errors prevent capture")
          )
        );
        return;
      }
      task.analyze();
      Inspector inspector = new Inspector(
        Trees.instance(task),
        root,
        new HashSet<>(files)
      );
      for (CompilationUnitTree unit : units) inspector.scan(unit, null);
      inspector.finish();
      for (Diagnostic<?> error : errors
        .getDiagnostics()
        .stream()
        .limit(200)
        .toList())
        if (error.getKind() == Diagnostic.Kind.ERROR) inspector.diagnostics.add(
          map(
            "code",
            "COMPILER_DIAGNOSTIC",
            "message",
            error.getCode() + ": " + error.getMessage(Locale.ROOT)
          )
        );
      System.out.println(
        encode(
          map(
            "version",
            Runtime.version().toString(),
            "nodes",
            inspector.nodes.values(),
            "generalizations",
            inspector.generalizations,
            "relations",
            inspector.relations,
            "diagnostics",
            inspector.diagnostics
          )
        )
      );
    }
  }
}
