/*
 * Health condition catalog. A curated list of the ~40 most genealogically
 * significant hereditary and chronic conditions, grouped into 7 categories.
 * Kept small and deliberate — this is family health history, not a medical
 * encyclopedia.
 */
export const HEALTH_CATEGORIES = [
  { id: 'heart',     label: 'Heart',          color: '#b85454' },
  { id: 'cancer',    label: 'Cancer',         color: '#7a5aa8' },
  { id: 'neuro',     label: 'Neurological',   color: '#3a72b8' },
  { id: 'mental',    label: 'Mental Health',  color: '#3a9090' },
  { id: 'metabolic', label: 'Metabolic',      color: '#b88830' },
  { id: 'chronic',   label: 'Chronic',        color: '#4a8a5a' },
  { id: 'genetic',   label: 'Genetic',        color: '#7a5870' },
];

export const HEALTH_CONDITIONS = [
  // Heart & Circulation
  { name: 'Heart Disease',        category: 'heart' },
  { name: 'High Blood Pressure',  category: 'heart' },
  { name: 'High Cholesterol',     category: 'heart' },
  { name: 'Stroke',               category: 'heart' },
  { name: 'Atrial Fibrillation',  category: 'heart' },
  { name: 'Heart Failure',        category: 'heart' },
  // Cancer
  { name: 'Breast Cancer',        category: 'cancer' },
  { name: 'Prostate Cancer',      category: 'cancer' },
  { name: 'Colorectal Cancer',    category: 'cancer' },
  { name: 'Lung Cancer',          category: 'cancer' },
  { name: 'Ovarian Cancer',       category: 'cancer' },
  { name: 'Melanoma',             category: 'cancer' },
  { name: 'Pancreatic Cancer',    category: 'cancer' },
  // Neurological
  { name: "Alzheimer's Disease",  category: 'neuro' },
  { name: "Parkinson's Disease",  category: 'neuro' },
  { name: 'Multiple Sclerosis',   category: 'neuro' },
  { name: 'Epilepsy',             category: 'neuro' },
  { name: 'Migraine',             category: 'neuro' },
  // Mental Health
  { name: 'Depression',           category: 'mental' },
  { name: 'Anxiety',              category: 'mental' },
  { name: 'Bipolar Disorder',     category: 'mental' },
  { name: 'Schizophrenia',        category: 'mental' },
  { name: 'ADHD',                 category: 'mental' },
  { name: 'OCD',                  category: 'mental' },
  { name: 'PTSD',                 category: 'mental' },
  // Metabolic
  { name: 'Type 1 Diabetes',      category: 'metabolic' },
  { name: 'Type 2 Diabetes',      category: 'metabolic' },
  { name: 'Thyroid Disease',      category: 'metabolic' },
  { name: 'Coeliac Disease',      category: 'metabolic' },
  { name: 'Obesity',              category: 'metabolic' },
  // Chronic
  { name: 'Asthma',               category: 'chronic' },
  { name: 'COPD',                 category: 'chronic' },
  { name: 'Rheumatoid Arthritis', category: 'chronic' },
  { name: "Crohn's Disease",      category: 'chronic' },
  { name: 'Psoriasis',            category: 'chronic' },
  { name: 'Kidney Disease',       category: 'chronic' },
  // Genetic
  { name: 'BRCA Mutation',        category: 'genetic' },
  { name: 'Haemophilia',          category: 'genetic' },
  { name: 'Cystic Fibrosis',      category: 'genetic' },
  { name: "Huntington's Disease", category: 'genetic' },
  { name: 'Sickle Cell Disease',  category: 'genetic' },
];

export const HEALTH_STATUSES = [
  { key: 'active',         label: 'Active' },
  { key: 'resolved',       label: 'Resolved' },
  { key: 'family_history', label: 'Family history' },
];

export function colorFor(category) {
  return HEALTH_CATEGORIES.find((c) => c.id === category)?.color ?? '#8a8480';
}
