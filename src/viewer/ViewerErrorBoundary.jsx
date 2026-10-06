import { Component } from "react";
export class ViewerErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="viewer-error" role="alert">
          <h1>The model could not be displayed</h1>
          <p>
            Rebuild the viewer from the model and check its validation report.
          </p>
          <button onClick={() => location.reload()}>Reload</button>
        </main>
      );
    return this.props.children;
  }
}
