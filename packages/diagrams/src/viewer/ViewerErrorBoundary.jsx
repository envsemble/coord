import { Component } from "react";
import { Alert, Button } from "@envsemble/envui";
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
    // A failure to load is a danger alert in the room the viewer takes.
    if (this.state.failed)
      return (
        <main className="viewer-error">
          <Alert
            tone="danger"
            announce
            title="The model could not be displayed"
            actions={
              <Button variant="secondary" onClick={() => location.reload()}>
                Reload
              </Button>
            }
          >
            Rebuild the viewer from the model and check its validation report.
          </Alert>
        </main>
      );
    return this.props.children;
  }
}
