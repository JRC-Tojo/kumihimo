import { describe, expect, test } from 'bun:test';
import type { AnnotationID } from 'src/models/document/pdf';
import { buildVariableMap, letterForMemberIndex } from '../groupFormula';

describe('letterForMemberIndex', () => {
  test('A-Zの範囲はアルファベット1文字を返す', () => {
    expect(letterForMemberIndex(0)).toBe('A');
    expect(letterForMemberIndex(1)).toBe('B');
    expect(letterForMemberIndex(25)).toBe('Z');
  });

  test('26件を超えるとExcelの列名と同じ規則で2文字目に繰り上がる', () => {
    expect(letterForMemberIndex(26)).toBe('AA');
    expect(letterForMemberIndex(27)).toBe('AB');
    expect(letterForMemberIndex(51)).toBe('AZ');
    expect(letterForMemberIndex(52)).toBe('BA');
  });
});

describe('buildVariableMap', () => {
  test('memberIdsの順序通りにA, B, C...を割り当てる', () => {
    const idA = '00000000-0000-4000-8000-000000000001' as AnnotationID;
    const idB = '00000000-0000-4000-8000-000000000002' as AnnotationID;
    const idC = '00000000-0000-4000-8000-000000000003' as AnnotationID;

    const map = buildVariableMap([idA, idB, idC]);
    expect(map.get('A')).toBe(idA);
    expect(map.get('B')).toBe(idB);
    expect(map.get('C')).toBe(idC);
    expect(map.size).toBe(3);
  });
});
