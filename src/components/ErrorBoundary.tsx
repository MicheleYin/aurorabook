import { Component, ReactNode } from "react";

import { logger } from "../lib/logger";
import { useTranslation } from "../lib/i18n";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  t: (key: string) => string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundaryInternal extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Always log errors in production for debugging
    // Use both console.error (always works) and logger (for consistency)
    console.error("ErrorBoundary caught:", error, errorInfo);
    logger.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  render() {
    const { t } = this.props;
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center p-8 min-h-[400px]">
            <h2 className="text-xl font-semibold mb-4">
              {t("error.something_wrong")}
            </h2>
            {this.state.error && (
              <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                {this.state.error.message || t("error.unexpected")}
              </p>
            )}
            <Button onClick={this.handleReset}>{t("error.try_again")}</Button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({
  children,
  fallback,
  onReset,
}: Omit<Props, "t">) {
  const { t } = useTranslation();
  return (
    <ErrorBoundaryInternal fallback={fallback} onReset={onReset} t={t}>
      {children}
    </ErrorBoundaryInternal>
  );
}
