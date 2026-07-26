import { db, auditScore, actionItem, captureResult, accessibilityFinding, visualFinding, copyFinding } from '../db/index.js';
import { eq } from 'drizzle-orm';

export type CritiqueStatus = {
  visualSuccess: boolean;
  copySuccess: boolean;
};

export async function runScoring(auditJobId: string, status: CritiqueStatus) {
  // 1. Fetch all data
  const [capture] = await db.select().from(captureResult).where(eq(captureResult.auditJobId, auditJobId));
  const axes = await db.select().from(accessibilityFinding).where(eq(accessibilityFinding.auditJobId, auditJobId));
  const visuals = await db.select().from(visualFinding).where(eq(visualFinding.auditJobId, auditJobId));
  const copies = await db.select().from(copyFinding).where(eq(copyFinding.auditJobId, auditJobId));

  if (!capture) {
    console.error(`[Scoring] No capture result found for job ${auditJobId}`);
    return;
  }

  // 2. Calculate Category Scores
  
  // Performance
  let perfScore: number | null = 100;
  // Weighting
  let lcpWeight = 40;
  let clsWeight = 40;
  let loadWeight = 20;

  if (capture.lcp === null) {
    lcpWeight = 0;
    clsWeight = 50;
    loadWeight = 50;
  }
  if (capture.cls === null) {
    clsWeight = 0;
    loadWeight += (capture.lcp === null ? 50 : 40);
    if (capture.lcp !== null) lcpWeight = 60;
  }

  let lcpScore = 100;
  if (capture.lcp !== null) {
    if (capture.lcp > 4000) lcpScore = 0;
    else if (capture.lcp > 2500) lcpScore = 100 - ((capture.lcp - 2500) / 1500) * 100;
  }

  let clsScore = 100;
  if (capture.cls !== null) {
    const clsVal = parseFloat(capture.cls.toString());
    if (clsVal > 0.25) clsScore = 0;
    else if (clsVal > 0.1) clsScore = 100 - ((clsVal - 0.1) / 0.15) * 100;
  }

  let loadScore = 100;
  if (capture.loadTimeMs > 5000) loadScore = 0;
  else if (capture.loadTimeMs > 2000) loadScore = 100 - ((capture.loadTimeMs - 2000) / 3000) * 100;

  perfScore = (lcpScore * (lcpWeight / 100)) + (clsScore * (clsWeight / 100)) + (loadScore * (loadWeight / 100));
  perfScore = Math.max(0, Math.round(perfScore));

  // Accessibility
  let axeScore: number | null = 100;
  for (const axe of axes) {
    if (axe.impact === 'critical') axeScore -= 20;
    else if (axe.impact === 'serious') axeScore -= 15;
    else if (axe.impact === 'moderate') axeScore -= 5;
    else axeScore -= 2;
  }
  axeScore = Math.max(0, axeScore);

  // Visual
  let visualScore: number | null = status.visualSuccess ? 100 : null;
  if (status.visualSuccess) {
    for (const v of visuals) {
      if (v.severity === 'high') visualScore! -= 25;
      else if (v.severity === 'medium') visualScore! -= 15;
      else visualScore! -= 5;
    }
    visualScore = Math.max(0, visualScore!);
  }

  // Copy
  let copyScore: number | null = status.copySuccess ? 100 : null;
  if (status.copySuccess) {
    for (const c of copies) {
      if (c.severity === 'high') copyScore! -= 25;
      else if (c.severity === 'medium') copyScore! -= 15;
      else copyScore! -= 5;
    }
    copyScore = Math.max(0, copyScore!);
  }

  // Overall
  let validCategories = 0;
  let totalScore = 0;
  if (perfScore !== null) { validCategories++; totalScore += perfScore; }
  if (axeScore !== null) { validCategories++; totalScore += axeScore; }
  if (visualScore !== null) { validCategories++; totalScore += visualScore; }
  if (copyScore !== null) { validCategories++; totalScore += copyScore; }

  const overallScore = validCategories > 0 ? Math.round(totalScore / validCategories) : null;

  // 3. Upsert AuditScore
  await db.insert(auditScore).values({
    auditJobId,
    overall: overallScore,
    breakdown: {
      visual: visualScore,
      copy: copyScore,
      accessibility: axeScore,
      performance: perfScore,
    }
  }).onConflictDoUpdate({
    target: auditScore.auditJobId,
    set: {
      overall: overallScore,
      breakdown: {
        visual: visualScore,
        copy: copyScore,
        accessibility: axeScore,
        performance: perfScore,
      }
    }
  });

  // 4. Rank Action Items
  type RawItem = {
    title: string;
    description: string;
    estimatedImpact: 'high' | 'medium' | 'low';
    findingType: string;
    findingId: string;
    weight: number;
  };

  const rawItems: RawItem[] = [];

  // Map accessibility
  for (const axe of axes) {
    let weight = 0;
    let impact: 'high' | 'medium' | 'low' = 'low';
    if (axe.impact === 'critical') { weight = 90; impact = 'high'; }
    else if (axe.impact === 'serious') { weight = 70; impact = 'medium'; }
    else if (axe.impact === 'moderate') { weight = 55; impact = 'low'; }
    else { weight = 10; impact = 'low'; }
    
    rawItems.push({
      title: `Accessibility: ${axe.ruleId}`,
      description: axe.description,
      estimatedImpact: impact,
      findingType: 'accessibility',
      findingId: axe.id,
      weight
    });
  }

  // Map visual
  if (status.visualSuccess) {
    for (const v of visuals) {
      let weight = 0;
      if (v.severity === 'high') weight = 100;
      else if (v.severity === 'medium') weight = 85;
      else weight = 45;

      rawItems.push({
        title: `Visual: ${v.category}`,
        description: v.description,
        estimatedImpact: v.severity as 'high' | 'medium' | 'low',
        findingType: 'visual',
        findingId: v.id,
        weight
      });
    }
  }

  // Map copy
  if (status.copySuccess) {
    for (const c of copies) {
      let weight = 0;
      if (c.severity === 'high') weight = 95;
      else if (c.severity === 'medium') weight = 80;
      else weight = 40;

      rawItems.push({
        title: `Copy: ${c.category}`,
        description: c.description,
        estimatedImpact: c.severity as 'high' | 'medium' | 'low',
        findingType: 'copy',
        findingId: c.id,
        weight
      });
    }
  }

  // Sort descending by weight
  rawItems.sort((a, b) => b.weight - a.weight);

  // Take top 20
  const topItems = rawItems.slice(0, 20);

  // Delete existing action items for idempotency
  await db.delete(actionItem).where(eq(actionItem.auditJobId, auditJobId));

  if (topItems.length > 0) {
    await db.insert(actionItem).values(
      topItems.map((item, idx) => ({
        auditJobId,
        rank: idx + 1,
        title: item.title,
        description: item.description,
        estimatedImpact: item.estimatedImpact,
        findingType: item.findingType,
        findingId: item.findingId
      }))
    );
  }
}
