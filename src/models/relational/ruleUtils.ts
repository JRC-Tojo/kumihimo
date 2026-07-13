import type { RelationalRule } from './fileSchema';

export type RelationalRuleType = RelationalRule['type'];

/**
 * ルール種別（'equal' | 'link'）からRelationalRuleを組み立てる
 *
 * `{ type: mode }`のようにユニオン型のまま組み立てると判別可能ユニオンとして
 * 型解決できないため、分岐によりリテラル型を確定させている
 */
export function buildRelationalRule(mode: RelationalRuleType): RelationalRule {
  switch (mode) {
    case 'equal':
      return { type: 'equal' };
    case 'link':
      return { type: 'link' };
  }
}
