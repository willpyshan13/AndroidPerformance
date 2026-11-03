package dev.apw.hprofload;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

/** Retains a deterministic object graph for end-to-end HPROF parser and dominator tests. */
public final class HprofLoadActivity extends Activity {
    private static final int NODE_COUNT = 350_000;
    private static Node root;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Node previous = null;
        for (int index = 0; index < NODE_COUNT; index++) {
            Node node = new Node(index, previous);
            previous = node;
        }
        root = previous;
        TextView status = new TextView(this);
        status.setText("Retained HPROF nodes: " + NODE_COUNT);
        setContentView(status);
    }

    private static final class Node {
        final int id;
        final Node previous;
        Node(int id, Node previous) {
            this.id = id;
            this.previous = previous;
        }
    }
}
