import { describe, expect, it } from 'vitest'
import { conciseRecordingTitle } from '../recording-title'

describe('AI recording title limit', () => {
  it.each([
    ['HubSpot Intake Review', 'HubSpot Intake Review'],
    ['  HubSpot\n Intake\t Workflow  and Form Design Review  ', 'HubSpot Intake Workflow and Form Design'],
    ['Intake Questionnaire and HubSpot Workflow Design Review', 'Intake Questionnaire and HubSpot Workflow Design'],
    ['Internationalization Internationalization Internationalization Review', 'Internationalization Internationalization'],
    ['😀'.repeat(61), '😀'.repeat(60)],
    ['x'.repeat(60), 'x'.repeat(60)],
    ['   ', '']
  ])('normalizes %j without splitting Unicode characters or partial words', (input, expected) => {
    expect(conciseRecordingTitle(input)).toBe(expected)
    expect(conciseRecordingTitle(expected)).toBe(expected)
  })
})
