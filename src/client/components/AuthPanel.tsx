import { useState, type SyntheticEvent } from "react";
import type { UserRole } from "../../stream/playlist";

type AuthPanelProps = {
	mode: UserRole;
	status: string;
	onAuthenticate: (password: string) => void;
};

export function AuthPanel({ mode, status, onAuthenticate }: AuthPanelProps) {
	const [password, setPassword] = useState("");
	const isAdmin = mode === "admin";
	const label = isAdmin ? "Admin password" : "Stream password";

	function submit(event: SyntheticEvent<HTMLFormElement>): void {
		event.preventDefault();

		const trimmedPassword = password.trim();

		if (trimmedPassword) {
			onAuthenticate(trimmedPassword);
		}
	}

	return (
		<section className="card auth-panel">
			<h2>{isAdmin ? "Admin login" : "Enter stream password"}</h2>

			<form className="add-form" onSubmit={submit}>
				<label htmlFor="passwordInput">{label}</label>
				<div className="input-row">
					<input
						id="passwordInput"
						name="passwordInput"
						type="password"
						autoComplete="current-password"
						placeholder={label}
						value={password}
						onChange={(event) => setPassword(event.currentTarget.value)}
					/>
					<button type="submit">{isAdmin ? "Join as admin" : "Join"}</button>
				</div>
			</form>

			<p className="panel-status">{status}</p>
		</section>
	);
}
