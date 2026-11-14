// src/ui/CoordMark.jsx
import { jsx, jsxs } from "react/jsx-runtime";
function CoordMark({ size = 28, label = "Coord" }) {
  return /* @__PURE__ */ jsxs(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "-9.21 0 135.947 135.947",
      role: label ? "img" : void 0,
      "aria-label": label || void 0,
      "aria-hidden": label ? void 0 : true,
      children: [
        /* @__PURE__ */ jsx(
          "path",
          {
            d: "M56.196 135.947 L56.4 78.936 C56.4 77.05 55.462 75.289 53.899 74.236 L0 37.023 L0 95.807 C0 98.364 1.312 100.743 3.475 102.107 Z",
            fill: "#02a878"
          }
        ),
        /* @__PURE__ */ jsx(
          "path",
          {
            d: "M56.196 135.947 L112.865 103.102 C115.765 101.475 117.55 98.4 117.527 95.076 L117.375 36.802 L89.978 51.879 L90.408 85.909 C90.397 87.625 89.498 89.213 88.032 90.106 L56.291 109.424 Z",
            fill: "#026248"
          }
        ),
        /* @__PURE__ */ jsx(
          "path",
          {
            d: "M89.978 51.879 L60.941 33.732 C59.552 32.89 57.805 32.911 56.437 33.788 L24.741 54.105 L0 37.023 L55.636 0.902 C57.483 -0.297 59.862 -0.301 61.713 0.893 L117.375 36.802 Z",
            fill: "#58b17e"
          }
        )
      ]
    }
  );
}
export {
  CoordMark
};
//# sourceMappingURL=mark.mjs.map
