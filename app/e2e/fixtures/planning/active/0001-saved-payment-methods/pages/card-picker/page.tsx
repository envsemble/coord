// How a returning customer picks a saved card at checkout: two layouts to choose between, the
// proposal's model beside them, and the work item's steps, read through the Atlas tools.
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Row, Column, Text } from '@envsemble/envui';
import { IconCreditCard } from '@envsemble/envui/icons/CreditCard';
import { Diagram, tool, useChoice, useJSON } from '@envsemble/atlas-page';
import "./style.css";

interface Layout { key: string; title: string; summary: string }

export default function CardPicker() {
  const layouts = useJSON<Layout[]>('layouts.json');
  const layout = useChoice<string>('layout');
  const [steps, setSteps] = useState<number | null>(null);
  useEffect(() => { tool<{ steps: unknown[] }>('work_status', { work: 'work-0001' }).then(status => setSteps(status.steps.length), () => setSteps(null)); }, []);
  return <Column gap={5} className="card-picker">
    <Column gap={1}>
      <Text render={<h1 />} variant="headline">Choosing a saved card</Text>
      <Text emphasis="muted">Pick the layout checkout should use{steps !== null ? ` · the plan has ${steps} steps` : ''}.</Text>
    </Column>
    <Row gap={4} wrap align="stretch">
      {(layouts.value ?? []).map(option => <Card key={option.key} className="layout-option">
        <Column gap={2}>
          <Row gap={2} align="center"><IconCreditCard /><Text variant="title">{option.title}</Text>{layout.value === option.key && <Badge tone="success">Chosen</Badge>}</Row>
          <Text>{option.summary}</Text>
          <Button variant={layout.value === option.key ? 'primary' : 'secondary'} disabled={layout.closed} onClick={() => void layout.choose(option.key)}>Choose {option.title}</Button>
        </Column>
      </Card>)}
    </Row>
    {layout.closed && <Text emphasis="muted">Settled{layout.note ? `: ${layout.note}` : ''}.</Text>}
    <Diagram path="../../diagrams/checkout-proposal.puml" height="28rem" />
  </Column>;
}
