import { Component } from "react";
import { Button, EmptyState } from "@envsemble/envui";
export class ViewerErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }
  render() {
    if (this.state.failed)
      return (
        <main className="viewer-error">
          <EmptyState
            tone="error"
            headingLevel={1}
            title="The model could not be displayed"
            description="Rebuild the viewer from the model and check its validation report."
            action={
              <Button variant="secondary" onClick={() => location.reload()}>
                Reload
              </Button>
            }
          />
        </main>
      );
    return this.props.children;
  }
}
