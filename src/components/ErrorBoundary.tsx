import { Component, ReactNode } from "react";

import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // ErrorBoundary needs to work even if logger fails, so use console.error directly
    // but only in dev mode to avoid production noise
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught:", error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center p-8 min-h-[400px]">
            <h2 className="text-xl font-semibold mb-4">Something went wrong</h2>
            {this.state.error && (
              <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                {this.state.error.message || "An unexpected error occurred"}
              </p>
            )}
            <Button onClick={this.handleReset}>Try again</Button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
