// Minimal CRACO configuration.
// Required by the "craco start"/"craco build" scripts.
// Declares the "@" -> "src" path alias used throughout the imports (e.g. "@/components/ui/button").
const path = require('path');

module.exports = {
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Same "@" alias for Jest ("craco test"), so components can be tested.
  // Jest 27 (react-scripts 5) ignores package "exports", which react-router 7
  // relies on, so its CommonJS builds are mapped explicitly (tests only).
  jest: {
    configure: {
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^react-router-dom$': '<rootDir>/node_modules/react-router-dom/dist/index.js',
        '^react-router$': '<rootDir>/node_modules/react-router/dist/development/index.js',
        '^react-router/dom$': '<rootDir>/node_modules/react-router/dist/development/dom-export.js',
      },
    },
  },
  style: {
    postcss: {
      loaderOptions: (postcssLoaderOptions) => {
        postcssLoaderOptions.postcssOptions = postcssLoaderOptions.postcssOptions || {};
        postcssLoaderOptions.postcssOptions.plugins = [
          require('tailwindcss'),
          require('autoprefixer'),
          ...(postcssLoaderOptions.postcssOptions.plugins || []),
        ];
        return postcssLoaderOptions;
      },
    },
  },
};
