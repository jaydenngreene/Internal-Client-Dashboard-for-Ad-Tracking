import * as React from "react";

import { cn } from "@/lib/utils";

// The uppercase-tracked micro-label pattern every inline form in the app uses above
// its inputs — pulled out once so it's a shared affordance, not copy-pasted per form.
function FieldLabel({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="field-label"
      className={cn("text-[11px] font-medium uppercase tracking-wider text-muted-foreground", className)}
      {...props}
    />
  );
}

export { FieldLabel };
