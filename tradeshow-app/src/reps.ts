// Sales reps for order attribution.
//
// `sosId` is the SOS Inventory rep id, which is also the value Salesforce stores
// in Opportunity.SOS_Sales_Rep__c. The booth picks a rep in the admin area; that
// rep's `sosId` rides along on each order and the backend sets it on the
// Salesforce Opportunity. Keep this list in sync with SOS/Salesforce.
export interface Rep {
  /** SOS rep id (string), e.g. "2". Empty string = unassigned/house. */
  sosId: string;
  name: string;
}

export const REPS: Rep[] = [
  { sosId: '2', name: 'Chris Roseen' },
  { sosId: '3', name: 'David Ehrlich' },
  { sosId: '8', name: 'Jessica Tollefson' },
  { sosId: '13', name: 'Roger Corazzo' },
  { sosId: '6', name: 'Jeff Bardon' },
  { sosId: '5', name: 'House (unassigned)' },
];
