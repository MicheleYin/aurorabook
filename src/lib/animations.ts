import { type ClassValue } from "clsx";
import { cn } from "./utils";

/**
 * Shared animation utilities and constants
 * 
 * This module provides a centralized animation system for consistent
 * timing, easing, and animation patterns across the application.
 */

// Animation durations (in milliseconds)
export const ANIMATION_DURATION = {
  fast: 150,
  normal: 200,
  medium: 300,
  slow: 400,
  slower: 500,
} as const;

// Animation easing functions
export const ANIMATION_EASING = {
  linear: "linear",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
  easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  easeInOutCubic: "cubic-bezier(0.65, 0, 0.35, 1)",
  spring: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
} as const;

// Common animation class combinations
export const animationClasses = {
  // Base transitions
  transitionFast: "transition-all",
  transitionNormal: "transition-all",
  transitionMedium: "transition-all",
  transitionSlow: "transition-all",
  
  // Colors only
  transitionColors: "transition-colors",
  
  // Opacity only
  transitionOpacity: "transition-opacity",
  
  // Transform only
  transitionTransform: "transition-transform",
  
  // Specific property transitions
  transitionPadding: "transition-[padding]",
  transitionShadow: "transition-shadow",
  
  // Fade animations
  fadeIn: "animate-in fade-in-0",
  fadeOut: "animate-out fade-out-0",
  
  // Slide animations
  slideUp: "animate-in slide-in-from-bottom-2",
  slideDown: "animate-in slide-in-from-top-2",
  slideLeft: "animate-in slide-in-from-right-2",
  slideRight: "animate-in slide-in-from-left-2",
  
  // Scale animations
  scaleIn: "animate-in zoom-in-95",
  scaleOut: "animate-out zoom-out-95",
  
  // Combined animations
  slideUpFade: "animate-in slide-in-from-bottom-2 fade-in-0",
  slideDownFade: "animate-in slide-in-from-top-2 fade-in-0",
  scaleFade: "animate-in zoom-in-95 fade-in-0",
} as const;

/**
 * Creates animation classes with consistent timing
 */
export function anim(
  type: "fast" | "normal" | "medium" | "slow" | "slower" = "normal",
  property: "all" | "colors" | "opacity" | "transform" | "padding" | "shadow" | "height" = "all",
  ...additionalClasses: ClassValue[]
): string {
  const durationMap = {
    fast: "duration-150",
    normal: "duration-200",
    medium: "duration-300",
    slow: "duration-400",
    slower: "duration-500",
  };
  
  const propertyMap = {
    all: "transition-all",
    colors: "transition-colors",
    opacity: "transition-opacity",
    transform: "transition-transform",
    padding: "transition-[padding]",
    shadow: "transition-shadow",
    height: "transition-[height,max-height]",
  };
  
  return cn(
    propertyMap[property],
    durationMap[type],
    ...additionalClasses
  );
}

/**
 * Creates fade animation classes
 */
export function fade(
  direction: "in" | "out" = "in",
  duration: "fast" | "normal" | "medium" | "slow" = "normal"
): string {
  const fadeClass = direction === "in" ? "fade-in-0" : "fade-out-0";
  const durationClass = `duration-${ANIMATION_DURATION[duration]}`;
  
  return cn(
    direction === "in" ? "animate-in" : "animate-out",
    fadeClass,
    durationClass
  );
}

/**
 * Creates slide animation classes
 */
export function slide(
  direction: "up" | "down" | "left" | "right",
  distance: 2 | 4 | 8 | 16 = 2
): string {
  const directionMap = {
    up: `slide-in-from-bottom-${distance}`,
    down: `slide-in-from-top-${distance}`,
    left: `slide-in-from-right-${distance}`,
    right: `slide-in-from-left-${distance}`,
  };
  
  return cn("animate-in", directionMap[direction]);
}

/**
 * Creates scale animation classes
 */
export function scale(
  direction: "in" | "out" = "in",
  amount: 90 | 95 | 100 | 105 = 95
): string {
  const scaleClass = direction === "in" ? `zoom-in-${amount}` : `zoom-out-${amount}`;
  
  return cn(
    direction === "in" ? "animate-in" : "animate-out",
    scaleClass
  );
}

/**
 * Creates hover lift animation classes (for cards, buttons, etc.)
 */
export function hoverLift(
  amount: 0.5 | 1 | 2 = 0.5,
  shadow: "sm" | "md" | "lg" = "md"
): string {
  return cn(
    `hover:-translate-y-${amount === 0.5 ? "0.5" : amount}`,
    `hover:shadow-${shadow}`
  );
}

/**
 * Creates hover scale animation classes
 */
export function hoverScale(
  amount: 1.02 | 1.05 | 1.1 = 1.05
): string {
  const scaleValue = amount === 1.02 ? "1.02" : amount === 1.05 ? "1.05" : "1.1";
  return `hover:scale-[${scaleValue}]`;
}

/**
 * Creates enter/exit animation classes for components
 */
export function enterExit(
  isVisible: boolean,
  type: "fade" | "slideUp" | "slideDown" | "scale" | "slideUpFade" | "scaleFade" = "fade"
): string {
  if (isVisible) {
    switch (type) {
      case "fade":
        return fade("in");
      case "slideUp":
        return slide("up");
      case "slideDown":
        return slide("down");
      case "scale":
        return scale("in");
      case "slideUpFade":
        return cn(slide("up"), fade("in"));
      case "scaleFade":
        return cn(scale("in"), fade("in"));
      default:
        return fade("in");
    }
  } else {
    switch (type) {
      case "fade":
        return fade("out");
      case "slideUp":
        return "animate-out slide-out-to-top";
      case "slideDown":
        return "animate-out slide-out-to-bottom";
      case "scale":
        return scale("out");
      case "slideUpFade":
        return cn("animate-out slide-out-to-top", fade("out"));
      case "scaleFade":
        return cn(scale("out"), fade("out"));
      default:
        return fade("out");
    }
  }
}

/**
 * Common animation patterns as class strings
 */
export const animPatterns = {
  // Card hover effect - enhanced with scale
  cardHover: cn(
    anim("normal", "all"),
    "hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-lg",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  ),
  
  
  // Button hover effect with scale
  buttonHover: cn(
    anim("normal", "all"),
    "hover:scale-[1.02]",
    "active:scale-[0.98]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "transition-transform duration-150 ease-out"
  ),
  
  // Image zoom on hover - smoother transition
  imageZoom: cn(
    anim("medium", "transform"),
    "group-hover:scale-110",
    "ease-out"
  ),
  
  // Cover image loading shimmer
  coverShimmer: cn(
    "animate-shimmer bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%]"
  ),
  
  // Navigation bar hide/show
  navBar: cn(
    anim("normal", "all"),
    "ease-out"
  ),
  
  // Audio player slide
  audioPlayer: cn(
    anim("medium", "all"),
    "ease-out"
  ),
  
  // Reader chrome transition
  readerChrome: cn(
    anim("medium", "all")
  ),
  
  // Progress bar fill - smooth transition
  progressBar: cn(
    anim("medium", "all"),
    "ease-in-out"
  ),
  
  // Progress bar with pulse effect (for active conversions)
  progressBarPulse: cn(
    anim("medium", "all"),
    "ease-in-out",
    "progress-bar-pulse"
  ),
  
  // Progress bar with shimmer effect
  progressBarShimmer: cn(
    anim("medium", "all"),
    "ease-in-out",
    "progress-bar-shimmer"
  ),
  
  // Progress bar with wave effect
  progressBarWave: cn(
    anim("medium", "all"),
    "ease-in-out",
    "progress-bar-wave",
    "relative overflow-hidden"
  ),
  
  // Dialog backdrop - enhanced fade-in
  dialogBackdrop: cn(
    "dialog-backdrop-enter"
  ),
  
  // Dialog content - scale from 0.95 to 1.0 with fade
  dialogContent: cn(
    "dialog-content-enter"
  ),
  
  // Dialog content exit
  dialogContentExit: cn(
    "dialog-content-exit"
  ),
  
  // Drawer slide with spring physics
  drawerSlideBottom: cn(
    "drawer-slide-in-bottom"
  ),
  
  drawerSlideBottomExit: cn(
    "drawer-slide-out-bottom"
  ),
  
  drawerSlideLeft: cn(
    "drawer-slide-in-left"
  ),
  
  drawerSlideLeftExit: cn(
    "drawer-slide-out-left"
  ),
  
  // Dialog section stagger animation
  dialogSection: cn(
    "dialog-section-enter"
  ),
  
  // View transition container
  viewTransition: cn(
    anim("medium", "all"),
    "ease-in-out"
  ),
  
  // View slide left (Library -> Reader -> Settings)
  viewSlideLeft: cn(
    "animate-in slide-in-from-right-4 fade-in-0 duration-300 ease-in-out"
  ),
  
  // View slide right (Settings -> Reader -> Library)
  viewSlideRight: cn(
    "animate-in slide-in-from-left-4 fade-in-0 duration-300 ease-in-out"
  ),
  
  // Chapter transition - slide left (next chapter)
  chapterSlideLeft: cn(
    "animate-in slide-in-from-right-8 fade-in-0 duration-300 ease-in-out"
  ),
  
  // Chapter transition - slide right (previous chapter)
  chapterSlideRight: cn(
    "animate-in slide-in-from-left-8 fade-in-0 duration-300 ease-in-out"
  ),
  
  // Chapter transition - cross fade
  chapterCrossFade: cn(
    "animate-in fade-in-0 duration-300 ease-in-out"
  ),
} as const;

/**
 * Creates view transition classes based on view direction
 */
export function viewTransition(
  fromView: "library" | "reader" | "settings" | null,
  toView: "library" | "reader" | "settings"
): string {
  if (!fromView) {
    // Initial load - just fade in
    return fade("in", "medium");
  }
  
  // Determine slide direction based on view order
  const viewOrder: Record<string, number> = {
    library: 0,
    reader: 1,
    settings: 2,
  };
  
  const fromOrder = viewOrder[fromView];
  const toOrder = viewOrder[toView];
  
  if (toOrder > fromOrder) {
    // Moving forward (Library -> Reader -> Settings) - slide left
    return animPatterns.viewSlideLeft;
  } else {
    // Moving backward (Settings -> Reader -> Library) - slide right
    return animPatterns.viewSlideRight;
  }
}

/**
 * Creates stagger animation delay classes for list items
 */
export function staggerDelay(index: number, baseDelay: number = 50): string {
  const delay = index * baseDelay;
  return `[animation-delay:${delay}ms]`;
}

/**
 * Creates stagger animation classes for dialog sections
 */
export function dialogSectionStagger(index: number, baseDelay: number = 40): string {
  return cn(
    animPatterns.dialogSection,
    staggerDelay(index, baseDelay)
  );
}

