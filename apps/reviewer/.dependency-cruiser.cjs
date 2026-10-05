const features = [
  'inbox',
  'review',
  'source-navigation',
  'pull-status',
  'stacks',
  'linus',
  'settings',
]
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'shared-is-pure',
      severity: 'error',
      from: { path: '^shared/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'shared-is-the-waist',
      severity: 'error',
      from: { path: '^shared/' },
      to: { path: '^(server|src)/' },
    },
    {
      name: 'shared-has-no-framework',
      severity: 'error',
      from: { path: '^shared/' },
      to: { path: 'node_modules/(react|react-dom|express)(/|$)' },
    },
    {
      name: 'browser-never-imports-server',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^server/' },
    },
    {
      name: 'vendor-is-a-leaf',
      severity: 'error',
      from: { path: '^src/vendor/' },
      to: { path: '^src/(?!vendor/)' },
    },
    {
      name: 'only-adapters-do-io',
      severity: 'error',
      from: { path: '^server/', pathNot: '^server/(adapters|http)/' },
      to: { path: '^(node:)?(child_process|fs|fs/promises|sqlite)$' },
    },
    ...features.map((feature) => ({
      name: `isolate-${feature}`,
      severity: 'error',
      from: { path: `^src/features/${feature}/` },
      to: { path: '^src/features/', pathNot: `^src/features/${feature}/` },
    })),
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|node_modules|\.data)/' },
  },
}
