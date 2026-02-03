
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    build: {
        lib: {
            entry: path.resolve(__dirname, 'src/content.ts'),
            name: 'AXTreeContent',
            fileName: () => `content.js`,
            formats: ['iife']
        },
        outDir: 'dist',
        emptyOutDir: false // Prevent deleting background.js
    },
    define: {
        'process.env.NODE_ENV': '"production"'
    }
});
