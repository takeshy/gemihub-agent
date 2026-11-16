import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('./',import.meta.url)),publicDir:false,base:'/',build:{outDir:'../dist',emptyOutDir:true,cssCodeSplit:false,rollupOptions:{output:{entryFileNames:'editor.js',assetFileNames:'editor.[ext]',inlineDynamicImports:true}}}});
