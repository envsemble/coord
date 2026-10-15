// Files the main process bundles as text (Vite's ?raw imports): the planning templates.
declare module '*?raw' {
  const text: string;
  export default text;
}
