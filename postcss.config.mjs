// Tailwind 4 is here for the ERP screens only (D-090). It is a no-op on the app's other
// stylesheets, which are hand-written CSS and contain no Tailwind directives — the plugin only acts
// where `@import "tailwindcss/..."` appears, which is src/app/erp/erp.css and nowhere else.
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
