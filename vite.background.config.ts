
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    build: {
        lib: {
            entry: path.resolve(__dirname, 'src/background.ts'),
            name: 'Background',
            fileName: () => `background.js`,
            formats: ['iife']
        },
        outDir: 'dist',
        emptyOutDir: false
    },
    define: {
        'process.env.NODE_ENV': '"production"'
    }
});
