import * as React from "react";

export function isToastInteraction(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest("[data-sonner-toaster], [data-sonner-toast]") !== null;
}

/** Portaled popovers live outside Dialog content; don't treat them as outside dismiss targets. */
export function isPopoverInteraction(event: Event): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest("[data-slot='popover-content'], [data-radix-popper-content-wrapper]") !== null;
}

export function separateInsideScrollChildren(children: React.ReactNode): {
  headerElement: React.ReactNode;
  footerElement: React.ReactNode;
  contentElements: React.ReactNode[];
} {
  let headerElement: React.ReactNode = null;
  let footerElement: React.ReactNode = null;
  const contentElements: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child)) {
      const childType =
        typeof child.type === "function" && "displayName" in child.type ? (child.type as { displayName?: string }).displayName : undefined;
      if (childType === "DialogHeader") {
        headerElement = child;
      } else if (childType === "DialogFooter") {
        footerElement = child;
      } else {
        contentElements.push(child);
      }
    } else {
      contentElements.push(child);
    }
  });

  return { headerElement, footerElement, contentElements };
}
