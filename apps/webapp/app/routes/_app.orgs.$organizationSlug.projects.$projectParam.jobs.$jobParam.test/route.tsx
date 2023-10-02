import { useForm } from "@conform-to/react";
import { parse } from "@conform-to/zod";
import { Form, useActionData, useSubmit } from "@remix-run/react";
import { ActionFunction, LoaderArgs, json } from "@remix-run/server-runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { z } from "zod";
import { JSONEditor } from "~/components/code/JSONEditor";
import { EnvironmentLabel } from "~/components/environments/EnvironmentLabel";
import { BreadcrumbLink } from "~/components/navigation/NavBar";
import { Button } from "~/components/primitives/Buttons";
import { Callout } from "~/components/primitives/Callout";
import { FormError } from "~/components/primitives/FormError";
import { Header2 } from "~/components/primitives/Headers";
import { Input } from "~/components/primitives/Input";
import { InputGroup } from "~/components/primitives/InputGroup";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/primitives/Select";
import { TextLink } from "~/components/primitives/TextLink";
import { redirectBackWithErrorMessage, redirectWithSuccessMessage } from "~/models/message.server";
import { TestJobPresenter } from "~/presenters/TestJobPresenter.server";
import { TestJobService } from "~/services/jobs/testJob.server";
import { requireUserId } from "~/services/session.server";
import { Handle } from "~/utils/handle";
import { JobParamsSchema, jobRunDashboardPath, trimTrailingSlash } from "~/utils/pathBuilder";

export const loader = async ({ request, params }: LoaderArgs) => {
  const userId = await requireUserId(request);
  const { organizationSlug, projectParam, jobParam } = JobParamsSchema.parse(params);

  const presenter = new TestJobPresenter();
  const { environments, runs, examples } = await presenter.call({
    userId,
    organizationSlug,
    projectSlug: projectParam,
    jobSlug: jobParam,
  });

  return typedjson({ environments, runs, examples });
};

const schema = z.object({
  payload: z.string().transform((payload, ctx) => {
    try {
      const data = JSON.parse(payload);
      return data as any;
    } catch (e) {
      console.log("parsing error", e);

      if (e instanceof Error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: e.message,
        });
      } else {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This is invalid JSON",
        });
      }
    }
  }),
  environmentId: z.string(),
  versionId: z.string(),
  accountId: z.string().optional(),
});

//todo save the chosen environment to a cookie (for that user), use it to default the env dropdown
export const action: ActionFunction = async ({ request, params }) => {
  const { organizationSlug, projectParam, jobParam } = JobParamsSchema.parse(params);

  const formData = await request.formData();

  const submission = parse(formData, { schema });

  if (!submission.value) {
    return json(submission);
  }

  const testService = new TestJobService();
  const run = await testService.call(submission.value);

  if (!run) {
    return redirectBackWithErrorMessage(
      request,
      "Unable to start a test run: Something went wrong"
    );
  }

  return redirectWithSuccessMessage(
    jobRunDashboardPath(
      { slug: organizationSlug },
      { slug: projectParam },
      { slug: jobParam },
      { id: run.id }
    ),
    request,
    "Test run created"
  );
};

export const handle: Handle = {
  breadcrumb: (match) => <BreadcrumbLink to={trimTrailingSlash(match.pathname)} title="Test" />,
};

const startingJson = "{\n\n}";

export default function Page() {
  const { environments, runs, examples } = useTypedLoaderData<typeof loader>();

  //form submission
  const submit = useSubmit();
  const lastSubmission = useActionData();

  //examples
  const [selectedCodeSampleId, setSelectedCodeSampleId] = useState(
    examples.at(0)?.id ?? runs.at(0)?.id
  );
  const selectedCodeSample =
    examples.find((e) => e.id === selectedCodeSampleId)?.payload ??
    runs.find((r) => r.id === selectedCodeSampleId)?.payload;

  const [defaultJson, setDefaultJson] = useState<string>(selectedCodeSample ?? startingJson);
  const setCode = useCallback((code: string) => {
    setDefaultJson(code);
  }, []);

  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string>(environments[0].id);
  const selectedEnvironment = environments.find((e) => e.id === selectedEnvironmentId);

  const currentJson = useRef<string>(defaultJson);
  const [currentAccountId, setCurrentAccountId] = useState<string | undefined>(undefined);

  const submitForm = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      submit(
        {
          payload: currentJson.current,
          environmentId: selectedEnvironmentId,
          versionId: selectedEnvironment?.versionId ?? "",
          ...(currentAccountId ? { accountId: currentAccountId } : {}),
        },
        {
          action: "",
          method: "post",
        }
      );
      e.preventDefault();
    },
    [currentJson, selectedEnvironmentId, currentAccountId]
  );

  const [form, { environmentId, payload, accountId }] = useForm({
    id: "test-job",
    lastSubmission,
    onValidate({ formData }) {
      return parse(formData, { schema });
    },
  });

  if (environments.length === 0) {
    return (
      <Callout variant="warning">
        Can't run a test when there are no environments. This shouldn't happen, please contact
        support.
      </Callout>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4">
      <div className="flex h-full max-h-full overflow-hidden">
        <Form
          className="flex h-full max-h-full grow flex-col gap-4 overflow-y-auto"
          method="post"
          {...form.props}
          onSubmit={(e) => submitForm(e)}
        >
          <div className="grid h-full grid-cols-[1fr_auto] overflow-hidden">
            <InputGroup fullWidth className="h-full overflow-hidden">
              <div className="h-full flex-1 overflow-auto rounded-l border border-border scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700">
                <JSONEditor
                  defaultValue={defaultJson}
                  readOnly={false}
                  basicSetup
                  onChange={(v) => {
                    currentJson.current = v;

                    //deselect the example if it's been edited
                    if (selectedCodeSampleId) {
                      if (v !== selectedCodeSample) {
                        setDefaultJson(v);
                        setSelectedCodeSampleId(undefined);
                      }
                    }
                  }}
                  height="100%"
                  min-height="100%"
                  max-height="100%"
                  autoFocus
                  placeholder="Use your schema to enter valid JSON or add one of the example payloads then click 'Run test'"
                  className="h-full"
                />
              </div>
            </InputGroup>
            <div className="flex h-full w-fit min-w-[20rem] flex-col gap-4 overflow-y-auto rounded-r border border-l-0 border-border p-4">
              {examples.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Header2>Example payloads</Header2>
                  {examples.map((example) => (
                    <Button
                      key={example.id}
                      type="button"
                      variant="menu-item"
                      onClick={(e) => {
                        setCode(example.payload ?? "");
                        setSelectedCodeSampleId(example.id);
                      }}
                      LeadingIcon={example.icon ?? "beaker"}
                      TrailingIcon={example.id === selectedCodeSampleId ? "check" : undefined}
                      fullWidth
                      textAlignLeft
                    >
                      {example.name}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Header2>Recent payloads</Header2>
                {runs.length === 0 ? (
                  <Callout variant="info">
                    Recent payloads will show here once you've completed a Run.
                  </Callout>
                ) : (
                  <div className="flex flex-col gap-2">
                    {runs.map((run) => (
                      <Button
                        key={run.id}
                        type="button"
                        variant="menu-item"
                        onClick={(e) => {
                          setCode(run.payload ?? "");
                          setSelectedCodeSampleId(run.id);
                        }}
                        LeadingIcon={"clock"}
                        TrailingIcon={run.id === selectedCodeSampleId ? "check" : undefined}
                        fullWidth
                        textAlignLeft
                      >
                        {run.number}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {selectedEnvironment?.hasAuthResolver && (
                <div className="flex flex-col gap-2">
                  <Header2>Account ID</Header2>
                  <InputGroup fullWidth>
                    <Input
                      type="text"
                      fullWidth
                      variant="large"
                      value={currentAccountId}
                      placeholder={`e.g. abc_1234`}
                      onChange={(e) => setCurrentAccountId(e.target.value)}
                    />
                    <FormError>{accountId.error}</FormError>
                  </InputGroup>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <TextLink
              href="https://trigger.dev/docs/documentation/guides/testing-jobs"
              trailingIcon="external-link"
              className="text-sm text-dimmed hover:text-bright"
            >
              Learn more about running tests
            </TextLink>
            <div className="flex flex-none items-center justify-end gap-2">
              {payload.error ? (
                <FormError id={payload.errorId}>{payload.error}</FormError>
              ) : (
                <div />
              )}
              <SelectGroup>
                <Select
                  name="environment"
                  value={selectedEnvironmentId}
                  onValueChange={setSelectedEnvironmentId}
                >
                  <SelectTrigger size="medium">
                    <SelectValue placeholder="Select environment" className="m-0 p-0" /> Environment
                  </SelectTrigger>
                  <SelectContent>
                    {environments.map((environment) => (
                      <SelectItem key={environment.id} value={environment.id}>
                        <EnvironmentLabel environment={environment} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SelectGroup>
              <Button
                type="submit"
                variant="primary/medium"
                LeadingIcon="beaker"
                leadingIconClassName="text-bright"
              >
                Run test
              </Button>
            </div>
          </div>
        </Form>
      </div>
    </div>
  );
}
