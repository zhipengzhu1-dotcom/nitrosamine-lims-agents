import type { RoughModule } from './RoughScreen';

// Decision 23: reading and Check entry stay rough until #37 and #38 settle how values compare and
// what a first failing value records. The other modules wait on their own decisions.
export const ROUGH_MODULES: readonly RoughModule[] = [
  {
    slug: 'deviations',
    title: 'Deviations',
    holds: 'Each Deviation with its Kind, Risk Level, Investigator and state, from Open to Closed, and the Holds it placed.',
    columns: ['Deviation', 'Kind', 'Risk Level', 'State', 'Investigator', 'Holds'],
    waitsOn: 'It waits on the Deviation workflow decision.',
  },
  {
    slug: 'equipment',
    title: 'Equipment and Checks',
    holds: "Each piece of Equipment with its Fitness Status, today's Checks from its Check Plan, and readings for Rooms and storage.",
    columns: ['Equipment', 'Fitness Status', 'Check due', 'Last Check', 'Room'],
    waitsOn: 'Check and reading entry waits on #37 and #38, so this screen makes no pass or fail comparison.',
  },
  {
    slug: 'inventory',
    title: 'Inventory',
    holds: 'Materials, Material Lots, Packs and Solutions, each with its Fitness Status, expiry and CoA.',
    columns: ['Material Lot', 'Material', 'Fitness Status', 'Expiry', 'Location'],
    waitsOn: 'It waits on the inventory model.',
  },
  {
    slug: 'documents',
    title: 'Documents',
    holds: 'Controlled Documents with their Document Status, Effective Date, owner and Periodic Review.',
    columns: ['Document', 'Type', 'Version', 'Status', 'Effective Date', 'Owner'],
    waitsOn: 'It waits on the document vault decision.',
  },
  {
    slug: 'eln',
    title: 'ELN',
    holds: 'Notebooks and their Notebook Entries, Addenda and Late Entries.',
    columns: ['Notebook', 'Entry', 'Author', 'Signed', 'Linked records'],
    waitsOn: 'It waits on the ELN decision.',
  },
  {
    slug: 'stability',
    title: 'Stability',
    holds: 'Studies, their Storage Conditions and Time Points, and each Pull with its Pull Window.',
    columns: ['Study', 'Condition', 'Time Point', 'Pull Window', 'State'],
    waitsOn: 'It waits on the stability decision.',
  },
];
