export function ErrorPage({ message }: { message: string }) {
  return (
    <>
      <h1>Something went wrong</h1>
      <p className="sub">{message}</p>
    </>
  );
}
