import { describe, expect, it } from 'bun:test';
import { buildRelationalRule } from '../ruleUtils';

describe('buildRelationalRule', () => {
  it("'equal'を渡すとtype: 'equal'のRelationalRuleを返す", () => {
    expect(buildRelationalRule('equal')).toEqual({ type: 'equal' });
  });

  it("'link'を渡すとtype: 'link'のRelationalRuleを返す", () => {
    expect(buildRelationalRule('link')).toEqual({ type: 'link' });
  });
});
