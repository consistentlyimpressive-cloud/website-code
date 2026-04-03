export const mockSkillTree = {
  root: {
    id: 'root',
    title: 'PHASE 1: FOUNDATION',
    status: 'COMPLETED', // COMPLETED, IN_PROGRESS, LOCKED
    description: 'Establish baseline metrics and daily habits.'
  },
  branches: [
    {
      id: 'branch_derm',
      title: 'DERMATOLOGY',
      nodes: [
        {
          id: 'derm_1',
          title: 'Cleansing Routine',
          status: 'COMPLETED',
          description: 'Use a gentle cleanser 2x daily. Remove all debris.'
        },
        {
          id: 'derm_2',
          title: 'Incorporate Exfoliant',
          status: 'IN_PROGRESS',
          description: 'Use BHA/AHA 2-3x a week to clear pores.'
        },
        {
          id: 'derm_3',
          title: 'Retinoid Adaptation',
          status: 'LOCKED',
          description: 'Introduce a retinoid for anti-aging.'
        }
      ]
    },
    {
      id: 'branch_morph',
      title: 'MORPHOLOGY',
      nodes: [
        {
          id: 'morph_1',
          title: 'Assess Baseline',
          status: 'COMPLETED',
          description: 'Calculate baseline BF%.'
        },
        {
          id: 'morph_2',
          title: 'Hit 15% Body Fat',
          status: 'IN_PROGRESS',
          description: 'Maintain caloric deficit.'
        },
        {
          id: 'morph_3',
          title: 'Sub-12% Cut',
          status: 'LOCKED',
          description: 'Aggressive cut for facial definition.'
        }
      ]
    }
  ]
};