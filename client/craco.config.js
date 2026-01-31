/**
 * CRACO config: expose NEXT_PUBLIC_* env vars to the client (Supabase uses these).
 * Create React App only exposes REACT_APP_* by default; this adds NEXT_PUBLIC_* so
 * you can use the exact variable names Supabase generates.
 */
module.exports = {
  webpack: {
    configure: (config) => {
      const definePlugin = config.plugins.find(
        (p) => p.constructor && p.constructor.name === 'DefinePlugin'
      );
      if (definePlugin && definePlugin.definitions) {
        const env = typeof process !== 'undefined' ? process.env : {};
        Object.keys(env).forEach((key) => {
          if (key.startsWith('NEXT_PUBLIC_')) {
            definePlugin.definitions[`process.env.${key}`] = JSON.stringify(env[key]);
          }
        });
      }
      return config;
    },
  },
};
