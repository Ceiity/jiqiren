import { Component, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Empty } from './Empty';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <Empty
          icon={TriangleAlert}
          title="页面出错了"
          subtitle={this.state.error.message}
          action={
            <button className="btn btn-filled" onClick={() => location.reload()}>
              重新加载
            </button>
          }
        />
      );
    }
    return this.props.children;
  }
}
