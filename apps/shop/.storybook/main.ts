import type { StorybookConfig } from "@storybook/react-vite";
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  // The parent finder and its administration page are shown from their real files. Only the
  // browser files of admin/ are served: that folder also holds private server state.
  staticDirs: ["../public", { from: "./parent-frame", to: "/parent-frame" }, { from: "../../../site", to: "/parent-site" },
    ...["index.html", "admin.js", "admin.css", "site-editor.js"].map(file => ({ from: `../../../admin/${file}`, to: `/parent-admin/${file}` }))],
  core: { disableTelemetry: true },
  typescript: { reactDocgen: false },
  viteFinal(config) {
    // Storybook runs without the application server. Never proxy to a live API.
    config.server = { ...config.server, proxy: {} };
    return config;
  },
};
export default config;
