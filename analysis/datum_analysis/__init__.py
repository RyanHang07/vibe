"""Datum's analysis layer.

The harness writes data; this reads it. They are different jobs with
different constraints, and statistical work is ordinary in Python where in
TypeScript it is unusual — splitting on that seam is an architecture, not a
language exercise.

Nothing here writes to the database. The primary source is the committed
snapshot in ``data/``, produced by ``npm run export``, which means every
figure in the writeup can be recomputed by anyone without database access
and without a provider key.
"""

__all__ = ["stats"]
