import antfu from '@antfu/eslint-config'

export default antfu({
  rules: {
    'ts/no-redeclare': 'off',
    'ts/no-namespace': 'off',
  },
})
