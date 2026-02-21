import type { ComplexityAnalysis } from './types.js';
import { countTokens } from '../token-counter.js';

/**
 * Heuristic analysis of user input to determine if it's complex enough
 * to warrant multi-agent orchestration. No LLM call needed.
 */
export function analyzeComplexity(input: string): ComplexityAnalysis {
  const lower = input.toLowerCase();

  // File references: count @file mentions
  const fileRefs = (input.match(/@[\w\-./\\]+/g) || []).length;
  const multipleFiles = fileRefs >= 3;

  // List-like patterns: numbered lists, bullet points, conjunctions
  let listCount = 0;
  const listPatterns = [
    /\d+[\.\)]\s/g,
    /[-*]\s/g,
    /\b(and also|also|then|next|finally|additionally|moreover)\b/gi,
  ];
  for (const pattern of listPatterns) {
    const matches = input.match(pattern);
    if (matches) listCount += matches.length;
  }
  const multipleSteps = listCount >= 3;

  // Keyword signals
  const hasRefactoring = /\b(refactor|restructure|reorganize|migrate|rename across|move to)\b/i.test(lower);
  const hasFeature = /\b(implement|create|build|add feature|new feature|full|complete)\b/i.test(lower);
  const hasDebugging = /\b(debug|fix all|fix multiple|investigate|troubleshoot)\b/i.test(lower);
  const hasResearch = /\b(research|explore|analyze|understand|find all|how does|architecture)\b/i.test(lower);
  const hasReview = /\b(review|audit|check quality|validate|test coverage)\b/i.test(lower);

  // Score
  let score = 0;
  const reasons: string[] = [];

  if (multipleFiles) { score += 2; reasons.push(`${fileRefs} files referenced`); }
  if (multipleSteps) { score += 2; reasons.push('multiple tasks detected'); }
  if (hasRefactoring) { score += 2; reasons.push('refactoring task'); }
  if (hasFeature) { score += 1; reasons.push('feature implementation'); }
  if (hasDebugging) { score += 1; reasons.push('debugging task'); }
  if (hasResearch) { score += 1; reasons.push('research needed'); }
  if (hasReview) { score += 1; reasons.push('review requested'); }

  // Long prompt as additional signal
  const tokenCount = countTokens(input);
  if (tokenCount > 200) { score += 1; reasons.push('detailed request'); }

  return {
    isComplex: score >= 3,
    reason: reasons.join(', '),
    suggestedSteps: Math.max(2, Math.min(10, Math.ceil(score * 1.5))),
    involvedFiles: fileRefs,
    hasMultipleTasks: multipleSteps,
  };
}
