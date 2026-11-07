const fs = require('fs');
const path = require('path');
const espree = require('espree');
const scope = require('eslint-scope');
/* Classic script interfaces: only declarations actually present in js/ are shared.
   Unknown names still fail no-undef, including misspelled cross-file calls. */
const rendererGlobals = {};
const rendererInterfaces = {};
for (const file of fs.readdirSync(path.join(__dirname, 'js')).filter(name => name.endsWith('.js'))) {
  const ast = espree.parse(fs.readFileSync(path.join(__dirname, 'js', file), 'utf8'), {ecmaVersion:2022,sourceType:'script',range:true});
  const names = scope.analyze(ast,{ecmaVersion:2022,sourceType:'script'}).globalScope.variables.map(variable => variable.name);
  rendererInterfaces[file] = names;
  for (const name of names) rendererGlobals[name] = 'writable';
}
module.exports = {
  root: true,
  env: { es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
  rules: {
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    'no-undef': 'error',
    'no-fallthrough': 'error',
    'no-redeclare': 'error',
    'no-unreachable': 'error',
    'eqeqeq': ['warn', 'always', {null:'ignore'}]
  },
  overrides: [
    {
      files: ['main.js', 'preload.js', 'store.js', 'reminders.js', 'startup-decide.js', 'habit-rules.js', 'backup-history.js', 'scripts/**/*.cjs', 'scripts/**/*.js'],
      env: { node: true, browser: false }
    },
    {
      files: ['ui.js'],
      env: { browser: true, node: false }
    },
    {
      /* Classic scripts share only the parsed interfaces declared below. */
      files: ['js/**/*.js'],
      env: { browser: true, node: false },
      rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', {vars:'local',args:'none',caughtErrors:'none'}] }
    },
    ...Object.entries(rendererInterfaces).map(([file,names]) => ({files:['js/'+file],globals:Object.fromEntries(Object.keys(rendererGlobals).map(name=>[name,names.includes(name)?'off':'writable']))}))
  ],
  ignorePatterns: ['node_modules/', 'artifacts/', 'dist/', 'scripts/verify/_archive/', 'scripts/verify/results/', 'scripts/verify/profiles/']
};
