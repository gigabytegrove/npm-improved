interface Props {
	children: React.ReactNode;
}

export function SiteContainer({ children }: Props) {
	return <main className="npmi-content">{children}</main>;
}
