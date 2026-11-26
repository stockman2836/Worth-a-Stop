import { parseExpressionAt } from 'acorn';

export function readNuxtData(source) {
  const marker = /window\.__NUXT__\s*=/.exec(source);
  if (!marker) return null;
  const expression = parseExpressionAt(source, marker.index + marker[0].length, { ecmaVersion: 2020 });
  let budget = 100000;
  function read(node, bindings = new Map(), depth = 0) {
    if (!node || depth > 100 || --budget < 0) throw Error('Embedded data limit exceeded');
    if (node.type === 'Literal' && !node.regex) return node.value;
    if (node.type === 'Identifier' && bindings.has(node.name)) return bindings.get(node.name);
    if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal' &&
        typeof node.argument.value === 'number') return -node.argument.value;
    if (node.type === 'ArrayExpression') return node.elements.map(item => read(item, bindings, depth + 1));
    if (node.type === 'ObjectExpression') {
      const value = Object.create(null);
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.computed || property.kind !== 'init') throw Error('Unsupported data property');
        const key = property.key.name ?? property.key.value;
        value[key] = read(property.value, bindings, depth + 1);
      }
      return value;
    }
    if (node.type === 'CallExpression' && node.callee.type === 'FunctionExpression' &&
        node.callee.body.body.length === 1 && node.callee.body.body[0].type === 'ReturnStatement') {
      const scope = new Map(bindings);
      for (const [index, param] of node.callee.params.entries()) {
        if (param.type !== 'Identifier') throw Error('Unsupported parameter');
        scope.set(param.name, read(node.arguments[index], bindings, depth + 1));
      }
      return read(node.callee.body.body[0].argument, scope, depth + 1);
    }
    throw Error('Unsupported embedded expression');
  }
  return read(expression);
}
