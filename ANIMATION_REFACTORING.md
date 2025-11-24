# Animation System Refactoring

This document outlines the refactoring of animations to use a shared animation system.

## Created Files

### `/src/lib/animations.ts`
A centralized animation utilities module that provides:
- **Constants**: Animation durations and easing functions
- **Helper Functions**: 
  - `anim()` - Creates animation classes with consistent timing
  - `fade()` - Creates fade animation classes
  - `slide()` - Creates slide animation classes
  - `scale()` - Creates scale animation classes
  - `hoverLift()` - Creates hover lift animation classes
  - `hoverScale()` - Creates hover scale animation classes
  - `enterExit()` - Creates enter/exit animation classes
- **Patterns**: Pre-defined animation patterns for common use cases

### Updated `/src/index.css`
Added CSS custom properties for animation durations and easings:
- `--anim-duration-fast`: 150ms
- `--anim-duration-normal`: 200ms
- `--anim-duration-medium`: 300ms
- `--anim-duration-slow`: 400ms
- `--anim-duration-slower`: 500ms
- `--anim-easing-*`: Various easing functions

Added utility classes:
- `.anim-fast`, `.anim-normal`, `.anim-medium`, `.anim-slow`, `.anim-slower`
- `.anim-ease-in-out`, `.anim-ease-out`, `.anim-ease-in`, `.anim-spring`

Added `@media (prefers-reduced-motion: reduce)` support for accessibility.

## Refactored Components

### 1. **App.tsx**
- **Before**: `transition-all duration-200`
- **After**: Uses `animPatterns.navBar` for navigation bar
- **Before**: `transition` on navigation buttons
- **After**: Uses `animPatterns.buttonHover` for buttons

### 2. **LibraryGrid.tsx**
- **Before**: `transition hover:-translate-y-0.5 hover:shadow-md`
- **After**: Uses `animPatterns.cardHover` for card hover effects
- **Before**: `transition duration-500 group-hover:scale-105`
- **After**: Uses `animPatterns.imageZoom` for cover image zoom

### 3. **LibraryList.tsx**
- **Before**: `transition` on list items
- **After**: Uses `anim("normal", "colors")` for color transitions

### 4. **LibrarySearchBar.tsx**
- **Before**: `transition` on input and clear button
- **After**: Uses `anim("normal", "all")` for input and `anim("normal", "colors")` for button

### 5. **LibraryHeader.tsx**
- **Before**: `transition` on filter and view mode buttons
- **After**: Uses `anim("normal", "colors")` for button transitions

### 6. **ReaderAudioPlayer.tsx**
- **Before**: `transition-all duration-200` and `transition-all duration-300 ease-out`
- **After**: Uses `animPatterns.navBar` and `animPatterns.audioPlayer`
- **Before**: Manual `translate-y-0 opacity-100 scale-100` classes
- **After**: Uses `enterExit()` helper function

### 7. **ReaderPanel.tsx**
- **Before**: `transition-all duration-300` for chrome
- **After**: Uses `animPatterns.readerChrome`
- **Before**: Manual `transition-all duration-300 ease-out` with opacity/scale classes
- **After**: Uses `enterExit()` helper function

### 8. **ReaderViewport.tsx**
- **Before**: `transition-colors` and `transition-[padding]`
- **After**: Uses `anim("normal", "colors")` and `anim("normal", "padding")`

### 9. **Button.tsx** (UI Component)
- **Before**: `transition-colors` hardcoded in buttonVariants
- **After**: Uses `animPatterns.buttonHover` applied to all buttons

### 10. **Progress.tsx** (UI Component)
- **Before**: `transition-all duration-300 ease-in-out`
- **After**: Uses `animPatterns.progressBar`

### 11. **Dialog.tsx** (UI Component)
- **Before**: `transition-opacity` on close button
- **After**: Uses `anim("normal", "opacity")`

## Benefits

1. **Consistency**: All animations now use the same timing and easing functions
2. **Maintainability**: Animation durations and easings are defined in one place
3. **Accessibility**: Built-in support for `prefers-reduced-motion`
4. **Type Safety**: TypeScript types for animation parameters
5. **Reusability**: Common patterns can be reused across components
6. **Performance**: CSS custom properties allow for easy theme customization

## Usage Examples

### Basic Transition
```tsx
import { anim } from "@/lib/animations";

<div className={anim("normal", "colors")}>
  {/* Content */}
</div>
```

### Using Pre-defined Patterns
```tsx
import { animPatterns } from "@/lib/animations";

<div className={animPatterns.cardHover}>
  {/* Card content */}
</div>
```

### Enter/Exit Animations
```tsx
import { enterExit } from "@/lib/animations";

<div className={enterExit(isVisible, "slideUpFade")}>
  {/* Content */}
</div>
```

### Custom Animations
```tsx
import { fade, slide } from "@/lib/animations";
import { cn } from "@/lib/utils";

<div className={cn(fade("in"), slide("up"))}>
  {/* Content */}
</div>
```

## Migration Notes

- All hardcoded `transition-*` classes have been replaced with the shared system
- Animation durations are now consistent across the app
- Easing functions are standardized
- Components can still override animations if needed by passing additional classes

## Future Improvements

1. Add more animation patterns as needed
2. Consider adding spring physics animations for more natural feel
3. Add stagger animations for list items
4. Consider using Framer Motion for complex animations

