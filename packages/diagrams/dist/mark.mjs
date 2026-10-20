// src/ui/AtlasMark.jsx
import { jsx, jsxs } from "react/jsx-runtime";
function AtlasMark({ size = 28, label = "Atlas" }) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "27 26.5 189 189",
      role: label ? "img" : void 0,
      "aria-label": label || void 0,
      "aria-hidden": label ? void 0 : true,
      children: [
        /* @__PURE__ */ jsx("rect", { x: "27", y: "27", width: "189", height: "188", rx: "43", fill: "#111820" }),
        /* @__PURE__ */ jsxs(
          "g",
          {
            fill: "none",
            stroke: "#fff",
            strokeWidth: "12",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            children: [
              /* @__PURE__ */ jsx("path", { d: "M76 163 L120 77 L164 163" }),
              /* @__PURE__ */ jsx("path", { d: "M96 132 H144" })
            ]
          }
        ),
        /* @__PURE__ */ jsxs("g", { fill: "#fff", children: [
          /* @__PURE__ */ jsx("circle", { cx: "120", cy: "77", r: "18" }),
          /* @__PURE__ */ jsx("circle", { cx: "76", cy: "163", r: "18" }),
          /* @__PURE__ */ jsx("circle", { cx: "164", cy: "163", r: "18" })
        ] })
      ]
    }
  );
}
export {
  AtlasMark
};
//# sourceMappingURL=mark.mjs.map
