import { Fragment } from "react";

// Insight copy is AI-generated prose where the one number that matters is
// buried mid-sentence ("Facebook spend rose 42% while revenue stayed flat") -
// a wall of same-weight muted text makes the reader parse the whole sentence
// to find it. The model wraps that number in **markdown bold**; this renders
// those spans as <strong> instead of showing literal asterisks.
export function BoldText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}
