/**
 * The mark of a page that needs its user (a decision, a review), until its agent clears it: a small
 * dot in the needs-you colour, named for assistive technology by what the page waits on.
 */
export function AttentionDot({ text }: { text: string }) {
  return <span className="attention-dot" role="img" aria-label={'Needs you: ' + text} title={'Needs you: ' + text} />;
}
