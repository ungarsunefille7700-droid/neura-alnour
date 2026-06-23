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
